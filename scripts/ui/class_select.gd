# scripts/ui/class_select.gd
extends Control

signal class_selected(peer_id: int, class_name: String)

@onready var warrior_btn: Button = $VBox/WarriorButton
@onready var mage_btn: Button = $VBox/MageButton
@onready var status_label: Label = $VBox/StatusLabel
@onready var waiting_label: Label = $VBox/WaitingLabel

var _my_selection: String = ""

func _ready() -> void:
	waiting_label.visible = false
	status_label.text = "Choose your class:"

func _on_warrior_button_pressed() -> void:
	_pick_class("warrior")

func _on_mage_button_pressed() -> void:
	_pick_class("mage")

func _pick_class(class_name: String) -> void:
	_my_selection = class_name
	warrior_btn.disabled = true
	mage_btn.disabled = true
	status_label.text = "Picked: %s" % class_name.capitalize()
	waiting_label.visible = true
	waiting_label.text = "Waiting for other player..." if not multiplayer.is_server() else "Waiting..."
	# Send selection to host (or process locally if solo/host)
	_submit_class.rpc_id(1, multiplayer.get_unique_id(), class_name)

@rpc("any_peer", "call_local", "reliable")
func _submit_class(peer_id: int, chosen_class: String) -> void:
	# Only host processes this
	if not multiplayer.is_server():
		return
	GameState.player_classes[peer_id] = chosen_class
	# Check if all connected peers have selected
	var all_selected := true
	for pid in GameState.connected_players:
		if not GameState.player_classes.has(pid):
			all_selected = false
			break
	if all_selected:
		_start_game.rpc()

@rpc("authority", "call_local", "reliable")
func _start_game() -> void:
	# Notify game.gd to begin
	get_tree().get_root().get_node("Game").begin_run()
