# scripts/mage.gd
extends PlayerBase

const BOLT_SCENE = preload("res://scenes/characters/magic_bolt.tscn")

var _last_direction := Vector2.RIGHT

func _setup_class_visuals() -> void:
	sprite.color = Color(0.6, 0.2, 0.8)
	name_label.text = "M" if int(name) == 1 else "M2"
	max_hp = 70
	attack_damage = 15
	attack_cooldown = 0.8
	health.max_hp = max_hp
	health.current_hp = max_hp
	current_hp = max_hp

func _handle_movement() -> void:
	var dir := Input.get_vector("move_left", "move_right", "move_up", "move_down")
	velocity = dir * SPEED
	move_and_slide()
	if dir.length() > 0.1:
		_last_direction = dir.normalized()
		state = State.MOVE
	else:
		state = State.IDLE

func _do_attack() -> void:
	state = State.ATTACK
	var bolt := BOLT_SCENE.instantiate() as CharacterBody2D
	bolt.direction = _last_direction
	bolt.damage = attack_damage
	bolt.position = global_position + _last_direction * 30.0
	# Add bolt to the same parent as players (World/Players node's parent)
	get_parent().get_parent().add_child(bolt)

func _restore_alive_visuals() -> void:
	sprite.color = Color(0.6, 0.2, 0.8)
