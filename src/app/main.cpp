#include "gui/MainWindow.h"

#include <QApplication>
#include <QCommandLineOption>
#include <QCommandLineParser>
#include <QSurfaceFormat>

#include <optional>

int main(int argc, char** argv) {
    QCoreApplication::setOrganizationName("PCloud");
    QCoreApplication::setApplicationName("OctreePointCloudViewer");

    QSurfaceFormat format;
    format.setRenderableType(QSurfaceFormat::OpenGL);
    format.setVersion(3, 3);
    format.setProfile(QSurfaceFormat::CoreProfile);
    format.setDepthBufferSize(24);
    format.setStencilBufferSize(8);
    format.setSamples(4);
    format.setSwapInterval(1);
    QSurfaceFormat::setDefaultFormat(format);

    QApplication application(argc, argv);
    QApplication::setApplicationDisplayName("Octree Point Cloud Streamer");
    Q_INIT_RESOURCE(resources);

    QCommandLineParser parser;
    parser.setApplicationDescription(
        "Disk-streamed octree point cloud viewer with SSE selection and frame-safe VRAM reuse.");
    parser.addHelpOption();
    parser.addOption(QCommandLineOption(
        {"s", "scene"}, "Point cloud scene file (*.pcloud).", "file"));
    parser.addOption(QCommandLineOption(
        "disk-mb-s", "Disk throttle in MiB/s; 0 means unlimited.", "value", "0"));
    parser.addOption(QCommandLineOption(
        "vram-mb", "GPU buffer budget in MiB; 0 means unlimited.", "value", "256"));
    parser.addOption(QCommandLineOption(
        "sse", "Screen-space error threshold in pixels.", "value", "6"));
    parser.addPositionalArgument("scene", "Optional scene file.", "[scene]");
    parser.process(application);

    QString scene = parser.value("scene");
    if (scene.isEmpty() && !parser.positionalArguments().isEmpty()) {
        scene = parser.positionalArguments().front();
    }
    auto parseOptional = [&parser](const QString& name) -> std::optional<double> {
        bool ok = false;
        const double value = parser.value(name).toDouble(&ok);
        return ok ? std::optional<double>(value) : std::nullopt;
    };
    const std::optional<double> disk = parseOptional("disk-mb-s");
    const std::optional<double> vram = parseOptional("vram-mb");
    const std::optional<double> sse = parseOptional("sse");

    MainWindow window(scene);
    window.setStartupBudgets(disk, vram, sse);
    window.show();
    return application.exec();
}
