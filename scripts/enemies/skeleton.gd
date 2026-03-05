# scripts/enemies/skeleton.gd
extends CharacterBody2D

const SPEED := 80.0
const ATTACK_RANGE := 48.0
const ATTACK_DAMAGE := 15
const TELEGRAPH_TIME := 0.5
const ATTACK_DURATION := 0.15
const COOLDOWN_TIME := 1.0
const HURT_TIME := 0.2

enum State { IDLE, CHASE, TELEGRAPH, ATTACK, COOLDOWN, HURT, DEAD }

# Synced to guest
var state: int = State.IDLE

var _state_timer: float = 0.0
var _target: Node2D = null

@onready var sprite: ColorRect = $ColorRect
@onready var health: HealthComponent = $HealthComponent
@onready var hitbox: Area2D = $AttackHitbox

func _ready() -> void:
	health.died.connect(_on_died)
	hitbox.body_entered.connect(_on_hitbox_body_entered)
	if not multiplayer.is_server():
		set_physics_process(false)

func _physics_process(delta: float) -> void:
	_state_timer -= delta
	match state:
		State.IDLE:
			_find_target()
			if _target:
				state = State.CHASE
		State.CHASE:
			_chase_target()
		State.TELEGRAPH:
			if _state_timer <= 0.0:
				_enter_attack()
		State.ATTACK:
			if _state_timer <= 0.0:
				_exit_attack()
		State.COOLDOWN:
			if _state_timer <= 0.0:
				state = State.CHASE
		State.HURT:
			if _state_timer <= 0.0:
				state = State.CHASE

func _find_target() -> void:
	var closest_dist := INF
	for player in get_tree().get_nodes_in_group("player"):
		if not player is CharacterBody2D:
			continue
		var d := global_position.distance_to(player.global_position)
		if d < closest_dist:
			closest_dist = d
			_target = player

func _chase_target() -> void:
	if _target == null or not is_instance_valid(_target):
		_target = null
		state = State.IDLE
		return
	var dist := global_position.distance_to(_target.global_position)
	if dist <= ATTACK_RANGE:
		_enter_telegraph()
	else:
		var dir := (_target.global_position - global_position).normalized()
		velocity = dir * SPEED
		move_and_slide()

func _enter_telegraph() -> void:
	state = State.TELEGRAPH
	_state_timer = TELEGRAPH_TIME
	velocity = Vector2.ZERO
	sprite.color = Color.RED

func _enter_attack() -> void:
	state = State.ATTACK
	_state_timer = ATTACK_DURATION
	hitbox.monitoring = true
	sprite.color = Color.DARK_RED
	# Check existing overlaps on the next physics frame (monitoring just enabled)
	call_deferred("_apply_attack_damage")

func _apply_attack_damage() -> void:
	if state != State.ATTACK:
		return
	for body in hitbox.get_overlapping_bodies():
		_damage_body(body)

func _on_hitbox_body_entered(body: Node2D) -> void:
	# Fires when a body enters the hitbox during the active attack window
	if state != State.ATTACK:
		return
	_damage_body(body)

func _damage_body(body: Node2D) -> void:
	if body.has_method("receive_damage"):
		body.receive_damage.rpc(ATTACK_DAMAGE)

func _exit_attack() -> void:
	hitbox.monitoring = false
	state = State.COOLDOWN
	_state_timer = COOLDOWN_TIME
	sprite.color = Color(0.8, 0.6, 0.4)

func _on_died() -> void:
	state = State.DEAD
	sprite.color = Color(0.2, 0.2, 0.2, 0.5)
	set_physics_process(false)
	await get_tree().create_timer(0.5).timeout
	queue_free()

# Called via RPC from owning peer when a player attack hitbox/bolt connects
@rpc("any_peer", "reliable")
func receive_damage_rpc(amount: int) -> void:
	if not multiplayer.is_server():
		return
	if state == State.DEAD:
		return
	health.take_damage(amount)
	if state != State.DEAD:
		state = State.HURT
		_state_timer = HURT_TIME
		sprite.color = Color.WHITE
