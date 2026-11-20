import os
import sys

from PySide6.QtCore import QUrl
from PySide6.QtGui import QGuiApplication
from PySide6.QtQuick import QQuickView


def main() -> int:
    app = QGuiApplication(sys.argv)
    view = QQuickView()
    view.setResizeMode(QQuickView.SizeRootObjectToView)
    view.resize(640, 480)
    qml_path = os.path.join(os.path.dirname(__file__), "qml", "smoke.qml")
    view.setSource(QUrl.fromLocalFile(qml_path))
    view.show()
    for _ in range(20):
        app.processEvents()
    img = view.grabWindow()
    out = os.path.join(os.path.dirname(__file__), "..", "artifacts", "smoke.png")
    ok = img.save(out)
    print("saved:", ok, out, "center:", img.pixelColor(320, 240).name())
    return 0


if __name__ == "__main__":
    sys.exit(main())
