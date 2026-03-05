# scripts/magic_bolt.gd
extends CharacterBody2D

const SPEED := 400.0
const MAX_DISTANCE := 800.0

var damage: int = 15
var direction: Vector2 = Vector2.RIGHT
var _distance_travelled: float = 0.0

func _ready() -> void:
	# Bolt only runs on the peer that spawned it (owning peer)
	pass

func _physics_process(delta: float) -> void:
	var collision := move_and_collide(direction * SPEED * delta)
	_distance_travelled += SPEED * delta

	if collision:
		# Hit a wall or something solid
		queue_free()
		return

	if _distance_travelled >= MAX_DISTANCE:
		queue_free()

func _on_hit_area_entered(area: Area2D) -> void:
	var enemy := area.get_parent()
	if enemy.has_method("receive_damage_rpc"):
		enemy.receive_damage_rpc.rpc_id(1, damage)
	queue_free()
