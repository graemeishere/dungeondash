extends Node

const PORT = 7777
const MAX_PEERS = 1  # One guest + host = 2 players total
const PLAYER_SCENE = preload("res://scenes/characters/player.tscn")

@onready var players_node: Node2D = $World/Players
@onready var main_menu: Control = $UI/MainMenu

func _ready() -> void:
	multiplayer.peer_connected.connect(_on_peer_connected)
	multiplayer.peer_disconnected.connect(_on_peer_disconnected)
	multiplayer.connected_to_server.connect(_on_connected_to_server)
	multiplayer.connection_failed.connect(_on_connection_failed)

# ── Hosting ──────────────────────────────────────────────────────────────────

func host_game() -> void:
	var peer := ENetMultiplayerPeer.new()
	var error := peer.create_server(PORT, MAX_PEERS)
	if error != OK:
		main_menu.set_status("Failed to create server (error %d)" % error)
		return

	multiplayer.multiplayer_peer = peer
	GameState.connected_players.append(1)  # Host is always peer ID 1
	_spawn_player(1)
	main_menu.set_status("Hosting on port %d — waiting for guest..." % PORT)
	_show_local_ip()

func _show_local_ip() -> void:
	# Display the local IP so the guest knows what to type
	var ips := IP.get_local_addresses()
	for ip in ips:
		# Filter for typical LAN IPv4 addresses
		if ip.begins_with("192.168.") or ip.begins_with("10."):
			main_menu.set_status("Hosting — your IP: %s" % ip)
			return

# ── Joining ───────────────────────────────────────────────────────────────────

func join_game(ip: String) -> void:
	var peer := ENetMultiplayerPeer.new()
	var error := peer.create_client(ip, PORT)
	if error != OK:
		main_menu.set_status("Failed to connect (error %d)" % error)
		return
	multiplayer.multiplayer_peer = peer

# ── Multiplayer Callbacks ─────────────────────────────────────────────────────

func _on_peer_connected(id: int) -> void:
	# Called on HOST when a new guest connects
	if not multiplayer.is_server():
		return
	GameState.connected_players.append(id)
	# Spawn the new guest's player on all peers
	_spawn_player.rpc(id)
	# Tell the new guest about the host player too
	_spawn_player.rpc_id(id, 1)
	main_menu.set_status("Guest connected!")

func _on_peer_disconnected(id: int) -> void:
	GameState.connected_players.erase(id)
	# Remove the disconnected player's node
	var player := players_node.get_node_or_null(str(id))
	if player:
		player.queue_free()
	main_menu.set_status("Guest disconnected. Continuing solo.")

func _on_connected_to_server() -> void:
	# Called on CLIENT when connection succeeds
	# Server will call _spawn_player RPC for us — nothing to do here
	main_menu.set_status("Connected!")

func _on_connection_failed() -> void:
	main_menu.set_status("Connection failed. Check the IP and try again.")

# ── Spawning ──────────────────────────────────────────────────────────────────

@rpc("authority", "call_local", "reliable")
func _spawn_player(peer_id: int) -> void:
	# Don't double-spawn
	if players_node.get_node_or_null(str(peer_id)) != null:
		return

	var player := PLAYER_SCENE.instantiate()
	player.name = str(peer_id)
	# Stagger starting positions so players don't overlap
	var offset := Vector2(100.0 + peer_id * 120.0, 360.0)
	player.position = offset
	players_node.add_child(player)
