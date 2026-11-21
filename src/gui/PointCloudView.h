#pragma once

#include "core/BufferPool.h"
#include "core/CameraPath.h"
#include "core/ChunkReader.h"
#include "core/FramePlanner.h"
#include "core/Metrics.h"
#include "core/SceneIndex.h"

#include <QElapsedTimer>
#include <QMetaObject>
#include <QMatrix4x4>
#include <QOpenGLBuffer>
#include <QOpenGLFunctions_3_3_Core>
#include <QOpenGLShaderProgram>
#include <QOpenGLVertexArrayObject>
#include <QOpenGLWidget>
#include <QPoint>
#include <QTimer>

#include <cstdint>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

class QMouseEvent;
class QWheelEvent;

class PointCloudView : public QOpenGLWidget, protected QOpenGLFunctions_3_3_Core {
    Q_OBJECT

public:
    enum class RenderOrder {
        BackToFront = 0,
        FrontToBackDebug = 1,
    };

    explicit PointCloudView(QWidget* parent = nullptr);
    ~PointCloudView() override;

    void setScene(std::shared_ptr<const pcloud::SceneIndex> scene,
                  pcloud::ChunkReader* reader,
                  std::uint64_t epoch);
    void clearScene();

    void setSseThreshold(double pixels);
    void setVramLimit(std::uint64_t bytes);
    void setAlpha(double alpha);
    void setPointSize(double pixels);
    void setRenderOrder(RenderOrder order);
    void setColorByNode(bool enabled);
    void setPathPlaying(bool playing);
    bool isPathPlaying() const { return pathPlaying_; }
    void resetCamera();
    void setRecording(bool enabled);
    bool saveRecording(const QString& path, QString* error);

    pcloud::MetricsSnapshot metrics() const;
    const pcloud::MetricsSnapshot& cachedMetrics() const { return lastMetrics_; }
    double sseThreshold() const { return planner_.config().sseThresholdPixels; }
    double pathDurationSeconds() const { return cameraPath_.duration(); }

signals:
    void metricsChanged();
    void loadingChanged();
    void pathPlayingChanged(bool playing);

protected:
    void initializeGL() override;
    void resizeGL(int width, int height) override;
    void paintGL() override;
    void mousePressEvent(QMouseEvent* event) override;
    void mouseMoveEvent(QMouseEvent* event) override;
    void wheelEvent(QWheelEvent* event) override;

private:
    struct GpuRecord {
        QOpenGLBuffer buffer{QOpenGLBuffer::VertexBuffer};
        int pointCount = 0;
        std::uint64_t bytes = 0;
    };

    struct RetiredRecord {
        std::unique_ptr<GpuRecord> record;
        std::uint64_t frame = 0;
    };

    struct Fence {
        GLsync sync = nullptr;
        std::uint64_t frame = 0;
    };

    struct RecordedFrame {
        std::uint64_t frame = 0;
        std::uint64_t missing = 0;
        std::uint64_t duplicates = 0;
        std::uint64_t visible = 0;
        std::uint64_t fallback = 0;
        std::uint64_t uploads = 0;
        std::uint64_t evictions = 0;
        std::uint64_t gpuBytes = 0;
        std::uint64_t gpuPeakBytes = 0;
        std::uint64_t gpuLimitBytes = 0;
        std::size_t cpuResident = 0;
        std::size_t gpuResident = 0;
    };

    void tick();
    void onChunkReady(pcloud::ChunkResult result);
    void requestChunk(std::uint32_t nodeId, double priority);
    pcloud::CameraView currentCamera() const;
    void captureOrbitFrom(const pcloud::CameraView& camera);
    void processUploads();
    void collectRetired();
    void drawVisible(const pcloud::FramePlan& plan,
                     const pcloud::CameraView& camera);
    void finishFrameFence();
    void recordTelemetry(const pcloud::FramePlan& plan,
                         std::uint64_t uploads,
                         std::uint64_t evictions,
                         std::uint64_t blockedEvictions);
    void updateCachedMetrics();

    bool createGpuRecord(std::uint32_t nodeId,
                         const pcloud::ChunkResult& chunk,
                         std::uint64_t bytes);
    void retireGpuRecord(std::uint32_t nodeId);
    void resetGpuResources();
    void shutdownGl();
    QVector3D paletteColor(std::uint32_t nodeId) const;
    QMatrix4x4 projectionMatrix() const;

    std::shared_ptr<const pcloud::SceneIndex> scene_;
    pcloud::ChunkReader* reader_ = nullptr;
    std::uint64_t sceneEpoch_ = 0;
    std::uint64_t frameNo_ = 0;

    pcloud::BufferPool bufferPool_{0};
    pcloud::FramePlanner planner_;
    pcloud::CameraPath cameraPath_;
    pcloud::MetricsCollector metrics_;
    pcloud::ChunkReaderStats lastIoStats_;
    pcloud::MetricsSnapshot lastMetrics_;
    std::unordered_map<std::uint32_t, pcloud::ChunkResult> pendingChunks_;
    std::unordered_set<std::uint32_t> requestedChunks_;
    std::unordered_map<std::uint32_t, std::unique_ptr<GpuRecord>> gpuRecords_;
    std::vector<RetiredRecord> retiredRecords_;
    std::vector<Fence> fences_;
    std::vector<RecordedFrame> recordedFrames_;
    bool recording_ = false;

    QOpenGLShaderProgram* shader_ = nullptr;
    QOpenGLVertexArrayObject vao_;
    QMetaObject::Connection contextConnection_;
    bool glReady_ = false;

    QTimer frameTimer_;
    QElapsedTimer pathClock_;
    bool pathPlaying_ = false;
    double pathSeconds_ = 0.0;
    double alpha_ = 0.55;
    double pointSize_ = 2.5;
    RenderOrder order_ = RenderOrder::BackToFront;
    bool colorByNode_ = false;

    pcloud::Vec3 orbitCenter_;
    double orbitRadius_ = 30.0;
    double orbitYaw_ = 0.7;
    double orbitPitch_ = 0.34;
    QPoint lastMouse_;
    bool dragging_ = false;
    std::uint64_t lastEvictions_ = 0;
    std::uint64_t lastBlockedEvictions_ = 0;
    std::uint64_t uploadsThisFrame_ = 0;
};
