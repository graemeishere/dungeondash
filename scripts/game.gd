# scripts/game.gd
extends Node

const PORT = 7777
const MAX_PEERS = 1
const WARRIOR_SCENE = preload("res://scenes/characters/warrior.tscn")
const MAGE_SCENE    = preload("res://scenes/characters/mage.tscn")
const ROOM_SCENE    = preload("res://scenes/rooms/combat_room.tscn")

@onready var players_node: Node2D  = $World/Players
@onready var world_node: Node2D    = $World
@onready var main_menu: Control    = $UI/MainMenu
@onready var class_select: Control = $UI/ClassSelect
@onready var hud: CanvasLayer      = $HUD

var _room: Node2D = null

func _ready() -> void:
	multiplayer.peer_connected.connect(_on_peer_connected)
	multiplayer.peer_disconnected.connect(_on_peer_disconnected)
	multiplayer.connected_to_server.connect(_on_connected_to_server)
	multiplayer.connection_failed.connect(_on_connection_failed)

# ── Hosting / Joining ─────────────────────────────────────────────────────────

func host_game() -> void:
	var peer := ENetMultiplayerPeer.new()
	var error := peer.create_server(PORT, MAX_PEERS)
	if error != OK:
		main_menu.set_status("Failed to create server (error %d)" % error)
		return
	multiplayer.multiplayer_peer = peer
	GameState.connected_players.append(1)
	_show_class_select()

func join_game(ip: String) -> void:
	var peer := ENetMultiplayerPeer.new()
	var error := peer.create_client(ip, PORT)
	if error != OK:
		main_menu.set_status("Failed to connect (error %d)" % error)
		return
	multiplayer.multiplayer_peer = peer

func _show_class_select() -> void:
	main_menu.visible = false
	class_select.visible = true

# ── Multiplayer Callbacks ─────────────────────────────────────────────────────

func _on_peer_connected(id: int) -> void:
	if not multiplayer.is_server():
		return
	GameState.connected_players.append(id)
	# Tell the newly-connected guest to show class select
	_show_class_select_guest.rpc_id(id)

func _on_peer_disconnected(id: int) -> void:
	GameState.connected_players.erase(id)
	var player := players_node.get_node_or_null(str(id))
	if player:
		player.queue_free()

func _on_connected_to_server() -> void:
	# Guest shows its own class select immediately after connecting
	_show_class_select()

func _on_connection_failed() -> void:
	main_menu.set_status("Connection failed. Check the IP and try again.")

# Tells a specific remote peer to show the class select screen.
# Only called by the host (authority).
@rpc("authority", "call_remote", "reliable")
func _show_class_select_guest() -> void:
	_show_class_select()

# ── Run Lifecycle ─────────────────────────────────────────────────────────────

func begin_run() -> void:
	# Called by ClassSelect._start_game() on all peers after all classes chosen
	class_select.visible = false
	# Only the host broadcasts the load — guests' calls would be rejected by Godot
	if multiplayer.is_server():
		_load_room.rpc()

@rpc("authority", "call_local", "reliable")
func _load_room() -> void:
	if _room != null:
		_room.queue_free()
	_room = ROOM_SCENE.instantiate()
	world_node.add_child(_room)
	if multiplayer.is_server():
		_room.room_cleared.connect(_on_room_cleared)
	# Spawn players
	for pid in GameState.connected_players:
		_spawn_player(pid)

func _spawn_player(peer_id: int) -> void:
	if players_node.get_node_or_null(str(peer_id)) != null:
		return
	var chosen := GameState.player_classes.get(peer_id, "warrior")
	var player := WARRIOR_SCENE.instantiate() if chosen == "warrior" else MAGE_SCENE.instantiate()
	player.name = str(peer_id)
	player.position = Vector2(300.0, 360.0) if peer_id == 1 else Vector2(500.0, 360.0)
	players_node.add_child(player)
	# Wire health updates to HUD
	player.get_node("HealthComponent").health_changed.connect(
		func(hp: int, mx: int) -> void: hud.update_hp(peer_id, hp, mx)
	)
	# Watch for downed state (host only — host tracks run-over condition)
	if multiplayer.is_server():
		player.downed.connect(_on_player_downed.bind(peer_id), CONNECT_ONE_SHOT)

func _on_room_cleared() -> void:
	_show_win.rpc()

@rpc("authority", "call_local", "reliable")
func _show_win() -> void:
	hud.show_win()

func _on_player_downed(peer_id: int) -> void:
	# Re-connect for future downed events (in case they get revived and downed again)
	var player := players_node.get_node_or_null(str(peer_id))
	if player:
		player.downed.connect(_on_player_downed.bind(peer_id), CONNECT_ONE_SHOT)
	# Check if ALL current players are downed
	var all_down := true
	for pid in GameState.connected_players:
		var p := players_node.get_node_or_null(str(pid)) as PlayerBase
		if p != null and p.state != PlayerBase.State.DOWNED:
			all_down = false
			break
	if all_down:
		_game_over.rpc()

@rpc("authority", "call_local", "reliable")
func _game_over() -> void:
	hud.show_lose()

func restart_run() -> void:
	# Only the host drives the restart (it owns the authority RPCs needed)
	if not multiplayer.is_server():
		return
	for child in players_node.get_children():
		child.queue_free()
	if _room != null:
		_room.queue_free()
		_room = null
	# Snapshot peers before reset_run() clears connected_players
	var peers := GameState.connected_players.duplicate()
	GameState.reset_run()
	# Re-populate connected_players since reset_run() clears it
	for pid in peers:
		GameState.connected_players.append(pid)
	_reset_to_class_select.rpc()

@rpc("authority", "call_local", "reliable")
func _reset_to_class_select() -> void:
	hud.win_overlay.visible = false
	hud.lose_overlay.visible = false
	class_select.visible = true
	class_select.reset()
