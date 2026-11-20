import QtQuick
import QtQuick3D

Rectangle {
    id: win
    width: 1280
    height: 720
    color: "#10141a"

    View3D {
        id: view
        objectName: "view3d"
        anchors.fill: parent
        camera: app.orthoMode ? orthoCam : perspCam

        environment: SceneEnvironment {
            clearColor: "#10141a"
            backgroundMode: SceneEnvironment.Color
            antialiasingMode: SceneEnvironment.MSAA
            antialiasingQuality: SceneEnvironment.Medium
        }

        PerspectiveCamera {
            id: perspCam
            position: app.camPosition
            rotation: app.camRotation
            fieldOfView: app.fovY
            clipNear: app.clipNear
            clipFar: app.clipFar
        }
        OrthographicCamera {
            id: orthoCam
            position: app.camPosition
            rotation: app.camRotation
            clipNear: app.clipNear
            clipFar: app.clipFar
            // magnification 1 maps 1 scene unit to 1 pixel (calibrated
            // against View3D.mapFrom3DScene at startup)
            verticalMagnification: Math.max(view.height / app.orthoHeight, 0.001)
            horizontalMagnification: Math.max(view.height / app.orthoHeight, 0.001)
        }

        DirectionalLight {
            eulerRotation.x: -45
            eulerRotation.y: -30
            brightness: 1.2
        }
        DirectionalLight {
            eulerRotation.x: -20
            eulerRotation.y: 150
            brightness: 0.5
        }

        Warehouse {}
    }

    AnnotationOverlay {
        anchors.fill: parent
    }

    // Occlusion probe: ray-pick each on-screen annotation anchor.
    Timer {
        interval: 100
        repeat: true
        running: true
        triggeredOnStart: true
        onTriggered: {
            var rows = app.occlusionQueryRows()
            for (var i = 0; i < rows.length; i++) {
                var r = rows[i]
                if (!r.on) {
                    app.setOcclusion(r.row, false)
                    continue
                }
                var hit = view.pick(r.x, r.y)
                var occ = hit.objectHit !== null && hit.distance < r.dist - 0.6
                app.setOcclusion(r.row, occ)
            }
        }
    }

    // HUD
    Rectangle {
        anchors.left: parent.left
        anchors.top: parent.top
        anchors.margins: 10
        width: hudCol.width + 20
        height: hudCol.height + 16
        radius: 6
        color: "#aa101418"
        Column {
            id: hudCol
            anchors.centerIn: parent
            spacing: 3
            Text {
                text: "路径: " + (app.pathName || "手动")
                color: "#7fd4ff"; font.pixelSize: 13
            }
            Text {
                text: "投影: " + (app.orthoMode ? "正交" : "透视")
                      + "   相机: (" + app.camPosition.x.toFixed(1) + ", "
                      + app.camPosition.y.toFixed(1) + ", "
                      + app.camPosition.z.toFixed(1) + ")"
                color: "#c8d4e0"; font.pixelSize: 12
            }
            Text {
                text: "O: 正交/透视   R: 运行全部路径   点击标签: 定位"
                color: "#8a97a5"; font.pixelSize: 11
            }
        }
    }

    Shortcut { sequence: "O"; onActivated: app.toggleProjection() }
    Shortcut { sequence: "R"; onActivated: app.runAllPaths() }
}
