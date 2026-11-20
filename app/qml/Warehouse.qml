import QtQuick
import QtQuick3D

Node {
    id: warehouse

    // Floor
    Model {
        source: "#Rectangle"
        pickable: true
        eulerRotation.x: -90
        scale: Qt.vector3d(4, 4, 1)   // 400 x 400 m
        materials: PrincipledMaterial { baseColor: "#3a4048" }
    }

    // Aisle guide lines
    Repeater3D {
        model: 5
        Model {
            source: "#Rectangle"
            pickable: true
            eulerRotation.x: -90
            position: Qt.vector3d(-80 + index * 40, 0.05, 0)
            scale: Qt.vector3d(0.02, 3.2, 1)
            materials: PrincipledMaterial { baseColor: "#c8b44a" }
        }
    }

    // Walls
    Repeater3D {
        model: 4
        Model {
            source: "#Cube"
            pickable: true
            property real ang: index * 90
            position: Qt.vector3d(150 * Math.sin(ang * Math.PI / 180), 15,
                                  150 * Math.cos(ang * Math.PI / 180))
            eulerRotation.y: ang
            scale: Qt.vector3d(3.0, 0.3, 0.2)
            materials: PrincipledMaterial { baseColor: "#5a6270" }
        }
    }

    // Rack boxes: 4 aisles x 8 bays x 4 levels = 128 boxes
    Repeater3D {
        model: 128
        Model {
            source: "#Cube"
            pickable: true
            property int aisle: Math.floor(index / 32)
            property int bay: Math.floor((index % 32) / 4)
            property int level: index % 4
            property real bx: -60 + aisle * 40
            property real bz: -70 + bay * 20
            property real by: 3 + level * 6
            position: Qt.vector3d(bx, by, bz)
            scale: Qt.vector3d(0.14, 0.05, 0.16)
            materials: PrincipledMaterial {
                baseColor: level === 3 ? "#b03a2e"
                         : level === 2 ? "#af7ac5"
                         : level === 1 ? "#5dade2" : "#7dcea0"
            }
        }
    }

    // Shelf slabs between levels (sparse, every other bay)
    Repeater3D {
        model: 32
        Model {
            source: "#Cube"
            pickable: true
            property int aisle: Math.floor(index / 8)
            property int bay: index % 8
            position: Qt.vector3d(-60 + aisle * 40, 6.2, -70 + bay * 20)
            scale: Qt.vector3d(0.16, 0.004, 0.18)
            materials: PrincipledMaterial { baseColor: "#9099a3" }
        }
    }

    // Annotation anchor markers (excluded from occlusion picking)
    Repeater3D {
        model: app.anchors
        Model {
            source: "#Sphere"
            position: Qt.vector3d(modelData.x, modelData.y, modelData.z)
            scale: Qt.vector3d(0.012, 0.012, 0.012)
            pickable: false
            materials: PrincipledMaterial {
                baseColor: modelData.c
                emissiveFactor: Qt.vector3d(1, 1, 1)
            }
        }
    }
}
