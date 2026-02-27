extends Control

@onready var ip_input: LineEdit = $VBoxContainer/IPInput
@onready var status_label: Label = $VBoxContainer/StatusLabel
@onready var host_button: Button = $VBoxContainer/HostButton
@onready var join_button: Button = $VBoxContainer/JoinButton

func _ready() -> void:
	ip_input.text = "127.0.0.1"
	status_label.text = ""

func _on_host_button_pressed() -> void:
	status_label.text = "Starting host..."
	host_button.disabled = true
	join_button.disabled = true
	get_tree().get_root().get_node("Game").host_game()

func _on_join_button_pressed() -> void:
	var ip := ip_input.text.strip_edges()
	if ip.is_empty():
		status_label.text = "Enter an IP address first."
		return
	status_label.text = "Connecting to %s..." % ip
	host_button.disabled = true
	join_button.disabled = true
	get_tree().get_root().get_node("Game").join_game(ip)

func set_status(text: String) -> void:
	status_label.text = text
