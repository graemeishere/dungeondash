# scripts/warrior.gd
extends PlayerBase

func _setup_class_visuals() -> void:
	sprite.color = Color.CORNFLOWER_BLUE
	name_label.text = "W" if int(name) == 1 else "W2"
	max_hp = 120
	attack_damage = 25
	attack_cooldown = 0.6
	health.max_hp = max_hp
	health.current_hp = max_hp
	current_hp = max_hp

func _do_attack() -> void:
	state = State.ATTACK
	# Enable hitbox for brief window
	var hitbox := $AttackHitbox as Area2D
	hitbox.monitoring = true
	# Check overlapping areas immediately (areas already in range)
	for area in hitbox.get_overlapping_areas():
		_try_damage_enemy(area)
	# Disable after brief window
	await get_tree().create_timer(0.1).timeout
	hitbox.monitoring = false

func _try_damage_enemy(area: Area2D) -> void:
	var enemy := area.get_parent()
	if enemy.has_method("receive_damage_rpc"):
		# Send damage to host
		enemy.receive_damage_rpc.rpc_id(1, attack_damage)
