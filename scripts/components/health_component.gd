# scripts/components/health_component.gd
extends Node
class_name HealthComponent

signal died
signal health_changed(new_hp: int, max_hp: int)

@export var max_hp: int = 100
var current_hp: int = 100

func _ready() -> void:
	current_hp = max_hp

func take_damage(amount: int) -> void:
	if current_hp <= 0:
		return
	current_hp = maxi(0, current_hp - amount)
	health_changed.emit(current_hp, max_hp)
	if current_hp == 0:
		died.emit()

func heal(amount: int) -> void:
	if is_dead():
		return
	current_hp = mini(max_hp, current_hp + amount)
	health_changed.emit(current_hp, max_hp)

func revive(amount: int) -> void:
	# Restore HP from dead/downed state — bypasses the is_dead() guard
	current_hp = mini(max_hp, maxi(1, amount))
	health_changed.emit(current_hp, max_hp)

func is_dead() -> bool:
	return current_hp <= 0

func get_ratio() -> float:
	if max_hp <= 0:
		return 0.0
	return float(current_hp) / float(max_hp)
