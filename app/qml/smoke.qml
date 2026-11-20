import QtQuick
import QtQuick3D

Rectangle {
    color: "#202020"
    View3D {
        anchors.fill: parent
        PerspectiveCamera { position: Qt.vector3d(0, 0, 600) }
        DirectionalLight {}
        Model {
            source: "#Cube"
            scale: Qt.vector3d(2, 2, 2)
            materials: PrincipledMaterial { baseColor: "tomato" }
            eulerRotation.y: 30
        }
    }
}
