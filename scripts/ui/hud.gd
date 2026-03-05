# scripts/ui/hud.gd
extends CanvasLayer

@onready var p1_bar: ProgressBar = $HBoxContainer/P1Box/P1HP
@onready var p2_bar: ProgressBar = $HBoxContainer/P2Box/P2HP
@onready var p2_box: VBoxContainer = $HBoxContainer/P2Box
@onready var win_overlay: Control = $WinOverlay
@onready var lose_overlay: Control = $LoseOverlay

func _ready() -> void:
	win_overlay.visible = false
	lose_overlay.visible = false
	p2_box.visible = GameState.connected_players.size() > 1

func update_hp(peer_id: int, hp: int, max_hp: int) -> void:
	var bar := p1_bar if peer_id == 1 else p2_bar
	bar.max_value = max_hp
	bar.value = hp

func show_win() -> void:
	win_overlay.visible = true

func show_lose() -> void:
	lose_overlay.visible = true

func _on_play_again_pressed() -> void:
	# TODO: restart_run() is implemented in Task 11 (game.gd M1 rewire)
	get_tree().get_root().get_node("Game").restart_run()

func _on_try_again_pressed() -> void:
	# TODO: restart_run() is implemented in Task 11 (game.gd M1 rewire)
	get_tree().get_root().get_node("Game").restart_run()
