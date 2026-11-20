import QtQuick
import QtQuick.Controls

// 2D overlay: one clickable label per annotation. Off-screen anchors are
// clamped to the viewport edge (positions come from the Python projector)
// and get a direction arrow; occluded anchors are dimmed.
Item {
    id: overlay
    anchors.fill: parent

    Repeater {
        model: app.annotations

        delegate: Item {
            id: label
            width: pill.width
            height: pill.height
            // Keep the whole pill inside the viewport; the projected
            // (possibly clamped) anchor point is model.x/model.y.
            x: Math.max(4, Math.min(model.x - width / 2, overlay.width - width - 4))
            y: Math.max(4, Math.min(model.y - height / 2, overlay.height - height - 4))
            opacity: model.occluded ? 0.4 : 1.0
            z: model.clamped ? 1 : 2

            Rectangle {
                id: pill
                width: row.implicitWidth + 18
                height: 26
                radius: 13
                color: model.clamped ? "#dd222222" : "#ee1c2430"
                border.color: model.color
                border.width: model.clamped ? 2 : 1

                Row {
                    id: row
                    anchors.centerIn: parent
                    spacing: 6
                    Rectangle {
                        width: 10; height: 10; radius: 5
                        color: model.color
                        anchors.verticalCenter: parent.verticalCenter
                    }
                    Text {
                        text: model.name
                        color: "white"
                        font.pixelSize: 13
                        anchors.verticalCenter: parent.verticalCenter
                    }
                    Text {
                        text: model.depth
                        color: "#9fb2c8"
                        font.pixelSize: 11
                        anchors.verticalCenter: parent.verticalCenter
                    }
                }
            }

            // Direction arrow, only while clamped to an edge. The
            // container rotates around the pill centre; the arrow sits
            // at the pill rim along the clamp direction so it stays
            // visible even when the pill itself touches the screen edge.
            Item {
                anchors.centerIn: pill
                width: 1; height: 1
                rotation: model.angle
                visible: model.clamped
                Text {
                    text: "\u27A4"   // ➤
                    color: model.color
                    font.pixelSize: 18
                    x: pill.width / 2 - 8
                    anchors.verticalCenter: parent.verticalCenter
                }
            }

            MouseArea {
                anchors.fill: pill
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: app.focusAnnotation(index)
                ToolTip.visible: containsMouse
                ToolTip.text: model.occluded ? model.name + "（被遮挡）" : model.name
            }
        }
    }
}
