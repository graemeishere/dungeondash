# scripts/player_base.gd
extends CharacterBody2D
class_name PlayerBase

signal downed

const SPEED := 200.0
const DOWNED_TIME := 20.0
const REVIVE_DISTANCE := 64.0
const REVIVE_HOLD_TIME := 1.5

# Override these in subclasses
@export var max_hp: int = 100
@export var attack_damage: int = 20
@export var attack_cooldown: float = 0.7

enum State { IDLE, MOVE, ATTACK, HURT, DOWNED }

# Synced to all peers via MultiplayerSynchronizer
var state: int = State.IDLE
var current_hp: int = 100  # synced; managed by owning peer

var _attack_timer: float = 0.0
var _revive_progress: float = 0.0

@onready var sprite: ColorRect = $ColorRect
@onready var name_label: Label = $NameLabel
@onready var health: HealthComponent = $HealthComponent

func _ready() -> void:
	add_to_group("player")
	var peer_id := int(name)
	set_multiplayer_authority(peer_id)
	health.max_hp = max_hp
	health.current_hp = max_hp
	current_hp = max_hp
	health.died.connect(_on_health_depleted)
	health.health_changed.connect(_on_health_changed)
	_setup_class_visuals()

func _setup_class_visuals() -> void:
	pass  # Overridden by Warrior / Mage

func _restore_alive_visuals() -> void:
	pass  # Overridden by subclass to restore color after revive

func _physics_process(delta: float) -> void:
	if not is_multiplayer_authority():
		return
	match state:
		State.IDLE, State.MOVE:
			_handle_movement()
			_handle_attack_input(delta)
			_handle_revive_input(delta)
		State.ATTACK:
			_attack_timer -= delta
			if _attack_timer <= 0.0:
				state = State.IDLE
		State.DOWNED:
			_revive_progress = 0.0
		State.HURT:
			pass  # Placeholder; subclasses or future tasks add hurt animation

func _handle_movement() -> void:
	var dir := Input.get_vector("move_left", "move_right", "move_up", "move_down")
	velocity = dir * SPEED
	move_and_slide()
	state = State.MOVE if dir.length() > 0.1 else State.IDLE

func _handle_attack_input(delta: float) -> void:
	_attack_timer -= delta
	if Input.is_action_just_pressed("attack") and _attack_timer <= 0.0:
		_do_attack()
		_attack_timer = attack_cooldown

func _do_attack() -> void:
	pass  # Overridden by subclass

func _handle_revive_input(delta: float) -> void:
	# Find a nearby downed teammate and hold attack to revive
	var players_node := get_parent()
	if players_node == null:
		return
	for player in players_node.get_children():
		if player == self or not player is PlayerBase:
			continue
		if player.state != State.DOWNED:
			continue
		if global_position.distance_to(player.global_position) <= REVIVE_DISTANCE:
			if Input.is_action_pressed("attack"):
				_revive_progress += delta
				if _revive_progress >= REVIVE_HOLD_TIME:
					_revive_progress = 0.0
					# Ask host to revive the downed player
					_request_revive.rpc_id(1, int(player.name))
			else:
				_revive_progress = 0.0
			return
	_revive_progress = 0.0

func _on_health_depleted() -> void:
	if not is_multiplayer_authority():
		return
	current_hp = 0
	_set_downed.rpc()

func _on_health_changed(new_hp: int, _max: int) -> void:
	current_hp = new_hp
	# Owning peer broadcasts to all remote peers so their HUDs update
	if is_multiplayer_authority():
		_sync_health.rpc(new_hp, health.max_hp)

@rpc("authority", "call_remote", "reliable")
func _sync_health(hp: int, max_hp: int) -> void:
	# Remote peers: update local state and re-emit so HUD lambda fires
	current_hp = hp
	health.health_changed.emit(hp, max_hp)

# ── RPC calls ────────────────────────────────────────────────────────────────

@rpc("authority", "call_local", "reliable")
func _set_downed() -> void:
	state = State.DOWNED
	sprite.color = Color(0.35, 0.35, 0.35, 0.8)
	downed.emit()

@rpc("any_peer", "call_local", "reliable")
func _request_revive(downed_peer_id: int) -> void:
	# Only host processes revive requests
	if not multiplayer.is_server():
		return
	var players_node := get_parent()
	var downed := players_node.get_node_or_null(str(downed_peer_id)) as PlayerBase
	if downed != null and downed.state == State.DOWNED:
		downed._do_revive.rpc()

@rpc("authority", "call_local", "reliable")
func _do_revive() -> void:
	state = State.IDLE
	var revive_hp := max_hp / 2
	health.revive(revive_hp)
	current_hp = health.current_hp
	_restore_alive_visuals()  # restore colour only, do not reset HP

# Called by host when an enemy hitbox overlaps this player's hurtbox
@rpc("any_peer", "call_local", "reliable")
func receive_damage(amount: int) -> void:
	if not is_multiplayer_authority():
		return
	health.take_damage(amount)
