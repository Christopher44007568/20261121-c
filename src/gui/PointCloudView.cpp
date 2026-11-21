#include "gui/PointCloudView.h"

#include "core/Geometry.h"

#include <QColor>
#include <QFile>
#include <QMetaObject>
#include <QMouseEvent>
#include <QOpenGLContext>
#include <QPointer>
#include <QTextStream>
#include <QVector3D>
#include <QWheelEvent>

#include <algorithm>
#include <cstddef>
#include <cmath>
#include <limits>

namespace {

pcloud::Vec3 orbitPosition(const pcloud::Vec3& center,
                           double radius,
                           double yaw,
                           double pitch) {
    const double horizontal = std::cos(pitch) * radius;
    return {
        center.x + std::sin(yaw) * horizontal,
        center.y + std::sin(pitch) * radius,
        center.z + std::cos(yaw) * horizontal,
    };
}

}  // namespace

PointCloudView::PointCloudView(QWidget* parent)
    : QOpenGLWidget(parent) {
    setMinimumSize(480, 320);
    setFocusPolicy(Qt::StrongFocus);
    setMouseTracking(true);
    frameTimer_.setInterval(16);
    frameTimer_.setTimerType(Qt::PreciseTimer);
    connect(&frameTimer_, &QTimer::timeout, this, &PointCloudView::tick);
    frameTimer_.start();
}

PointCloudView::~PointCloudView() {
    frameTimer_.stop();
    QObject::disconnect(contextConnection_);
    shutdownGl();
}

void PointCloudView::setScene(std::shared_ptr<const pcloud::SceneIndex> scene,
                              pcloud::ChunkReader* reader,
                              std::uint64_t epoch) {
    const std::uint64_t vramLimit = bufferPool_.maxGpuBytes();
    if (context() && isValid()) {
        makeCurrent();
        resetGpuResources();
        doneCurrent();
    }

    scene_ = std::move(scene);
    reader_ = reader;
    sceneEpoch_ = epoch;
    frameNo_ = 0;
    pendingChunks_.clear();
    requestedChunks_.clear();
    bufferPool_ = pcloud::BufferPool(vramLimit);
    metrics_.reset();
    lastIoStats_ = {};
    lastMetrics_ = {};
    lastEvictions_ = 0;
    lastBlockedEvictions_ = 0;
    recordedFrames_.clear();

    if (scene_) {
        cameraPath_ = pcloud::CameraPath::orbitAround(scene_->header().bounds, 24.0, 10);
        orbitCenter_ = scene_->header().bounds.center();
        orbitRadius_ = std::max(6.0, scene_->header().bounds.diagonal() * 1.15);
        orbitYaw_ = 0.7;
        orbitPitch_ = 0.34;
    } else {
        cameraPath_ = {};
    }
    pathPlaying_ = false;
    pathSeconds_ = 0.0;
    pathClock_.restart();
    update();
    emit loadingChanged();
}

void PointCloudView::clearScene() {
    setScene({}, nullptr, sceneEpoch_ + 1);
}

void PointCloudView::setSseThreshold(double pixels) {
    pcloud::PlannerConfig config = planner_.config();
    config.sseThresholdPixels = std::max(0.1, pixels);
    planner_.setConfig(config);
}

void PointCloudView::setVramLimit(std::uint64_t bytes) {
    bufferPool_.setMaxGpuBytes(bytes);
}

void PointCloudView::setAlpha(double alpha) {
    alpha_ = std::clamp(alpha, 0.02, 1.0);
}

void PointCloudView::setPointSize(double pixels) {
    pointSize_ = std::clamp(pixels, 0.5, 8.0);
}

void PointCloudView::setRenderOrder(RenderOrder order) {
    order_ = order;
}

void PointCloudView::setColorByNode(bool enabled) {
    colorByNode_ = enabled;
}

void PointCloudView::setPathPlaying(bool playing) {
    if (!scene_ || cameraPath_.empty()) {
        pathPlaying_ = false;
        return;
    }
    if (playing && !pathPlaying_) {
        pathClock_.restart();
        pathSeconds_ = 0.0;
    } else if (!playing && pathPlaying_) {
        captureOrbitFrom(cameraPath_.at(pathSeconds_, height(), 45.0));
    }
    pathPlaying_ = playing;
    emit pathPlayingChanged(pathPlaying_);
    update();
}

void PointCloudView::resetCamera() {
    if (!scene_) {
        return;
    }
    pathPlaying_ = false;
    orbitCenter_ = scene_->header().bounds.center();
    orbitRadius_ = std::max(6.0, scene_->header().bounds.diagonal() * 1.15);
    orbitYaw_ = 0.7;
    orbitPitch_ = 0.34;
    update();
}

void PointCloudView::setRecording(bool enabled) {
    if (enabled && !recording_) {
        recordedFrames_.clear();
    }
    recording_ = enabled;
}

pcloud::MetricsSnapshot PointCloudView::metrics() const {
    return metrics_.snapshot();
}

bool PointCloudView::saveRecording(const QString& path, QString* error) {
    QFile file(path);
    if (!file.open(QIODevice::WriteOnly | QIODevice::Text)) {
        if (error) {
            *error = file.errorString();
        }
        return false;
    }
    QTextStream output(&file);
    output << "frame,missing_chunks,duplicate_nodes,visible_nodes,fallback_nodes,"
              "uploads,evictions,gpu_bytes,gpu_peak_bytes,gpu_limit_bytes,"
              "cpu_resident,gpu_resident\n";
    for (const RecordedFrame& row : recordedFrames_) {
        output << row.frame << ',' << row.missing << ',' << row.duplicates << ','
               << row.visible << ',' << row.fallback << ',' << row.uploads << ','
               << row.evictions << ',' << row.gpuBytes << ',' << row.gpuPeakBytes << ','
               << row.gpuLimitBytes << ',' << row.cpuResident << ',' << row.gpuResident
               << '\n';
    }
    output.flush();
    if (file.error() != QFileDevice::NoError) {
        if (error) {
            *error = file.errorString();
        }
        return false;
    }
    return true;
}

void PointCloudView::tick() {
    if (!scene_) {
        return;
    }
    if (pathPlaying_) {
        pathSeconds_ = static_cast<double>(pathClock_.elapsed()) / 1000.0;
    }
    update();
}

void PointCloudView::onChunkReady(pcloud::ChunkResult result) {
    requestedChunks_.erase(result.nodeId);
    if (!result.ok) {
        update();
        return;
    }
    const std::uint64_t bytes = result.points.size() * sizeof(pcloud::Point);
    bufferPool_.addCpu(result.nodeId, bytes);
    pendingChunks_[result.nodeId] = std::move(result);
    emit loadingChanged();
    update();
}

void PointCloudView::requestChunk(std::uint32_t nodeId, double priority) {
    if (!reader_ || !scene_) {
        return;
    }
    if (requestedChunks_.find(nodeId) != requestedChunks_.end() ||
        bufferPool_.contains(nodeId)) {
        return;
    }
    requestedChunks_.insert(nodeId);
    QPointer<PointCloudView> self(this);
    const std::uint64_t epoch = sceneEpoch_;
    const bool accepted = reader_->request(
        nodeId, priority, [self, epoch](pcloud::ChunkResult result) {
            if (!self) {
                return;
            }
            QMetaObject::invokeMethod(
                self.data(),
                [self, epoch, result = std::move(result)]() mutable {
                    if (self && self->sceneEpoch_ == epoch) {
                        self->onChunkReady(std::move(result));
                    }
                },
                Qt::QueuedConnection);
        });
    if (!accepted) {
        requestedChunks_.erase(nodeId);
    }
}

void PointCloudView::initializeGL() {
    initializeOpenGLFunctions();
    contextConnection_ = connect(
        context(), &QOpenGLContext::aboutToBeDestroyed,
        this, &PointCloudView::shutdownGl);

    shader_ = new QOpenGLShaderProgram();
    const bool vertexOk =
        shader_->addShaderFromSourceFile(QOpenGLShader::Vertex, ":/shaders/point.vert");
    const bool fragmentOk =
        shader_->addShaderFromSourceFile(QOpenGLShader::Fragment, ":/shaders/point.frag");
    const bool linkOk = vertexOk && fragmentOk && shader_->link();
    if (!linkOk) {
        qWarning("Point shader failed: %s", qPrintable(shader_->log()));
    }
    vao_.create();
    glEnable(GL_DEPTH_TEST);
    glEnable(GL_PROGRAM_POINT_SIZE);
    glDisable(GL_CULL_FACE);
    glReady_ = true;
}

void PointCloudView::resizeGL(int width, int height) {
    glViewport(0, 0, width, height);
}

void PointCloudView::paintGL() {
    if (!glReady_) {
        return;
    }
    glClearColor(0.012f, 0.018f, 0.03f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
    if (!scene_ || !shader_) {
        return;
    }

    collectRetired();
    ++frameNo_;
    bufferPool_.beginFrame(frameNo_);
    const pcloud::CameraView camera = currentCamera();
    const std::vector<pcloud::CameraView> lookahead =
        pathPlaying_
            ? cameraPath_.lookahead(
                  pathSeconds_, 4, 0.65, camera.viewportHeight, camera.verticalFovDegrees)
            : std::vector<pcloud::CameraView>{};
    const pcloud::FramePlan plan = planner_.plan(
        *scene_, camera, bufferPool_.gpuReadyIds(), bufferPool_.availableIds(), lookahead);
    for (const pcloud::RenderItem& render : plan.render) {
        bufferPool_.pin(render.nodeId);
    }

    processUploads();
    drawVisible(plan, camera);
    for (const pcloud::RequestItem& request : plan.requests) {
        requestChunk(request.nodeId, request.priority);
    }
    bufferPool_.unpinAll();
    finishFrameFence();

    const pcloud::BufferPoolStats stats = bufferPool_.stats();
    const std::uint64_t uploads = uploadsThisFrame_;
    const std::uint64_t evictions = stats.evictions - lastEvictions_;
    const std::uint64_t blocked =
        stats.blockedEvictionCandidates - lastBlockedEvictions_;
    recordTelemetry(plan, uploads, evictions, blocked);
    uploadsThisFrame_ = 0;
    lastEvictions_ = stats.evictions;
    lastBlockedEvictions_ = stats.blockedEvictionCandidates;
    updateCachedMetrics();
    if (frameNo_ % 20 == 0) {
        emit metricsChanged();
    }
}

pcloud::CameraView PointCloudView::currentCamera() const {
    pcloud::CameraView camera;
    camera.viewportHeight =
        std::max(1, static_cast<int>(std::lround(height() * devicePixelRatioF())));
    camera.verticalFovDegrees = 45.0;
    if (pathPlaying_ && !cameraPath_.empty()) {
        return cameraPath_.at(
            pathSeconds_,
            camera.viewportHeight,
            camera.verticalFovDegrees);
    }
    camera.target = orbitCenter_;
    camera.position = orbitPosition(
        orbitCenter_, orbitRadius_, orbitYaw_, orbitPitch_);
    return camera;
}

void PointCloudView::captureOrbitFrom(const pcloud::CameraView& camera) {
    orbitCenter_ = camera.target;
    const pcloud::Vec3 offset = camera.position - camera.target;
    orbitRadius_ = std::max(0.5, pcloud::length(offset));
    orbitPitch_ = std::asin(std::clamp(offset.y / orbitRadius_, -0.999, 0.999));
    orbitYaw_ = std::atan2(offset.x, offset.z);
}

QMatrix4x4 PointCloudView::projectionMatrix() const {
    const double radius =
        scene_ ? std::max(4.0, scene_->header().bounds.diagonal()) : 32.0;
    QMatrix4x4 projection;
    projection.perspective(
        45.0f,
        static_cast<float>(std::max(1, width())) / static_cast<float>(std::max(1, height())),
        static_cast<float>(std::max(0.01, radius * 0.0005)),
        static_cast<float>(radius * 40.0));
    return projection;
}

void PointCloudView::processUploads() {
    uploadsThisFrame_ = 0;
    std::vector<std::uint32_t> ids;
    ids.reserve(pendingChunks_.size());
    for (const auto& [id, chunk] : pendingChunks_) {
        (void)chunk;
        if (bufferPool_.isCpuReady(id)) {
            ids.push_back(id);
        }
    }
    std::sort(ids.begin(), ids.end(), [this](std::uint32_t left, std::uint32_t right) {
        const std::uint8_t leftDepth = scene_->node(left).depth;
        const std::uint8_t rightDepth = scene_->node(right).depth;
        if (leftDepth != rightDepth) {
            return leftDepth < rightDepth;
        }
        return left < right;
    });

    const std::uint64_t limit = bufferPool_.maxGpuBytes();
    if (limit != 0 && bufferPool_.gpuBytes() > limit) {
        const pcloud::EvictionResult trim =
            bufferPool_.evictFor(0, limit, frameNo_);
        for (std::uint32_t evicted : trim.evicted) {
            retireGpuRecord(evicted);
        }
    }
    for (std::uint32_t id : ids) {
        auto pending = pendingChunks_.find(id);
        if (pending == pendingChunks_.end() || bufferPool_.isGpuReady(id)) {
            continue;
        }
        const std::uint64_t bytes =
            pending->second.points.size() * sizeof(pcloud::Point);
        if (limit != 0 && bufferPool_.gpuBytes() + bytes > limit) {
            const pcloud::EvictionResult eviction =
                bufferPool_.evictFor(bytes, limit, frameNo_);
            for (std::uint32_t evicted : eviction.evicted) {
                retireGpuRecord(evicted);
            }
            if (!eviction.fits) {
                continue;
            }
        }
        if (!createGpuRecord(id, pending->second, bytes)) {
            continue;
        }
        if (!bufferPool_.commitGpu(id)) {
            retireGpuRecord(id);
            continue;
        }
        pendingChunks_.erase(pending);
        ++uploadsThisFrame_;
    }
}

bool PointCloudView::createGpuRecord(std::uint32_t nodeId,
                                     const pcloud::ChunkResult& chunk,
                                     std::uint64_t bytes) {
    if (chunk.points.empty() || bytes > static_cast<std::uint64_t>(
                                          std::numeric_limits<int>::max())) {
        return false;
    }
    auto record = std::make_unique<GpuRecord>();
    if (!record->buffer.create()) {
        return false;
    }
    record->buffer.bind();
    record->buffer.setUsagePattern(QOpenGLBuffer::StaticDraw);
    record->buffer.allocate(chunk.points.data(), static_cast<int>(bytes));
    record->buffer.release();
    if (!record->buffer.isCreated()) {
        return false;
    }
    record->pointCount = static_cast<int>(chunk.points.size());
    record->bytes = bytes;
    gpuRecords_[nodeId] = std::move(record);
    return true;
}

void PointCloudView::retireGpuRecord(std::uint32_t nodeId) {
    auto iterator = gpuRecords_.find(nodeId);
    if (iterator == gpuRecords_.end()) {
        return;
    }
    retiredRecords_.push_back(RetiredRecord{std::move(iterator->second), frameNo_});
    gpuRecords_.erase(iterator);
}

QVector3D PointCloudView::paletteColor(std::uint32_t nodeId) const {
    const float hue = std::fmod(static_cast<float>(nodeId) * 0.6180339f, 1.0f);
    const QColor color = QColor::fromHsvF(hue, 0.78, 0.98);
    return QVector3D(color.redF(), color.greenF(), color.blueF());
}

void PointCloudView::drawVisible(const pcloud::FramePlan& plan,
                                 const pcloud::CameraView& camera) {
    if (!shader_ || !shader_->isLinked() || plan.render.empty()) {
        return;
    }
    std::vector<const pcloud::RenderItem*> ordered;
    ordered.reserve(plan.render.size());
    for (const pcloud::RenderItem& item : plan.render) {
        if (gpuRecords_.find(item.nodeId) != gpuRecords_.end()) {
            ordered.push_back(&item);
        }
    }
    std::sort(ordered.begin(), ordered.end(),
              [this](const pcloud::RenderItem* left, const pcloud::RenderItem* right) {
                  if (order_ == RenderOrder::BackToFront) {
                      return left->distance > right->distance;
                  }
                  return left->distance < right->distance;
              });

    const QMatrix4x4 projection = projectionMatrix();
    QMatrix4x4 view;
    view.lookAt(
        QVector3D(static_cast<float>(camera.position.x),
                  static_cast<float>(camera.position.y),
                  static_cast<float>(camera.position.z)),
        QVector3D(static_cast<float>(camera.target.x),
                  static_cast<float>(camera.target.y),
                  static_cast<float>(camera.target.z)),
        QVector3D(0.0f, 1.0f, 0.0f));
    const QMatrix4x4 mvp = projection * view;
    const bool transparent = alpha_ < 0.999;
    glEnable(GL_DEPTH_TEST);
    if (transparent) {
        glEnable(GL_BLEND);
        glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
        glDepthMask(GL_FALSE);
    } else {
        glDisable(GL_BLEND);
        glDepthMask(GL_TRUE);
    }

    shader_->bind();
    shader_->setUniformValue("uMvp", mvp);
    shader_->setUniformValue("uView", view);
    shader_->setUniformValue(
        "uViewportHeight", static_cast<float>(camera.viewportHeight));
    shader_->setUniformValue("uPointSize", static_cast<float>(pointSize_));
    shader_->setUniformValue(
        "uAlpha", static_cast<float>(transparent ? alpha_ : 1.0));
    shader_->setUniformValue("uNodeTintMix", colorByNode_ ? 1.0f : 0.0f);

    vao_.bind();
    for (const pcloud::RenderItem* item : ordered) {
        auto recordIt = gpuRecords_.find(item->nodeId);
        if (recordIt == gpuRecords_.end()) {
            continue;
        }
        GpuRecord& record = *recordIt->second;
        record.buffer.bind();
        glEnableVertexAttribArray(0);
        glVertexAttribPointer(
            0, 3, GL_FLOAT, GL_FALSE, sizeof(pcloud::Point),
            reinterpret_cast<const void*>(offsetof(pcloud::Point, x)));
        glEnableVertexAttribArray(1);
        glVertexAttribPointer(
            1, 4, GL_UNSIGNED_BYTE, GL_TRUE, sizeof(pcloud::Point),
            reinterpret_cast<const void*>(offsetof(pcloud::Point, rgba)));
        shader_->setUniformValue("uNodeTint", paletteColor(item->nodeId));
        glDrawArrays(GL_POINTS, 0, record.pointCount);
        record.buffer.release();
    }
    glDisableVertexAttribArray(0);
    glDisableVertexAttribArray(1);
    vao_.release();
    shader_->release();
    glDepthMask(GL_TRUE);
}

void PointCloudView::finishFrameFence() {
    glFlush();
    GLsync sync = glFenceSync(GL_SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (sync) {
        fences_.push_back(Fence{sync, frameNo_});
    }
}

void PointCloudView::collectRetired() {
    std::uint64_t readyThrough = 0;
    bool anyReady = false;
    std::vector<Fence> remaining;
    remaining.reserve(fences_.size());
    for (const Fence& fence : fences_) {
        const GLenum status = glClientWaitSync(fence.sync, 0, 0);
        if (status == GL_ALREADY_SIGNALED || status == GL_CONDITION_SATISFIED) {
            glDeleteSync(fence.sync);
            readyThrough = std::max(readyThrough, fence.frame);
            anyReady = true;
        } else {
            remaining.push_back(fence);
        }
    }
    fences_ = std::move(remaining);
    if (!anyReady) {
        return;
    }
    auto iterator = retiredRecords_.begin();
    while (iterator != retiredRecords_.end()) {
        if (iterator->frame <= readyThrough) {
            if (iterator->record && iterator->record->buffer.isCreated()) {
                iterator->record->buffer.destroy();
            }
            iterator = retiredRecords_.erase(iterator);
        } else {
            ++iterator;
        }
    }
}

void PointCloudView::recordTelemetry(const pcloud::FramePlan& plan,
                                     std::uint64_t uploads,
                                     std::uint64_t evictions,
                                     std::uint64_t blockedEvictions) {
    const pcloud::BufferPoolStats stats = bufferPool_.stats();
    pcloud::FrameTelemetry telemetry;
    telemetry.missingChunks = plan.missingChunks;
    telemetry.duplicateNodes = plan.duplicateNodes;
    telemetry.requiredFrontier = plan.requiredFrontier;
    telemetry.visibleNodes = plan.render.size();
    telemetry.fallbackNodes = static_cast<std::uint64_t>(std::count_if(
        plan.render.begin(), plan.render.end(),
        [](const pcloud::RenderItem& item) { return item.fallback; }));
    telemetry.gpuBytes = stats.gpuBytes;
    telemetry.gpuPeakBytes = stats.peakGpuBytes;
    telemetry.gpuLimitBytes = bufferPool_.maxGpuBytes();
    telemetry.uploads = uploads;
    telemetry.evictions = evictions;
    telemetry.blockedEvictions = blockedEvictions;
    telemetry.cpuResident = stats.cpuResident;
    telemetry.gpuResident = stats.gpuResident;
    if (reader_) {
        telemetry.requestsQueued = reader_->stats().queued + reader_->stats().inFlight;
    }
    metrics_.recordFrame(telemetry);

    if (recording_ && recordedFrames_.size() < 300'000) {
        recordedFrames_.push_back(RecordedFrame{
            frameNo_,
            plan.missingChunks,
            plan.duplicateNodes,
            plan.render.size(),
            telemetry.fallbackNodes,
            uploads,
            evictions,
            stats.gpuBytes,
            stats.peakGpuBytes,
            bufferPool_.maxGpuBytes(),
            stats.cpuResident,
            stats.gpuResident,
        });
    }
}

void PointCloudView::updateCachedMetrics() {
    lastIoStats_ = reader_ ? reader_->stats() : pcloud::ChunkReaderStats{};
    metrics_.setIoStats(lastIoStats_);
    lastMetrics_ = metrics_.snapshot();
}

void PointCloudView::resetGpuResources() {
    if (glReady_) {
        glFinish();
    }
    for (const Fence& fence : fences_) {
        if (fence.sync) {
            glDeleteSync(fence.sync);
        }
    }
    fences_.clear();
    for (auto& [id, record] : gpuRecords_) {
        (void)id;
        if (record && record->buffer.isCreated()) {
            record->buffer.destroy();
        }
    }
    gpuRecords_.clear();
    for (RetiredRecord& retired : retiredRecords_) {
        if (retired.record && retired.record->buffer.isCreated()) {
            retired.record->buffer.destroy();
        }
    }
    retiredRecords_.clear();
}

void PointCloudView::shutdownGl() {
    if (!glReady_ && !shader_ && gpuRecords_.empty() && retiredRecords_.empty()) {
        return;
    }
    QOpenGLContext* currentContext = context();
    if (currentContext && currentContext->isValid()) {
        makeCurrent();
    }
    resetGpuResources();
    delete shader_;
    shader_ = nullptr;
    if (vao_.isCreated()) {
        vao_.destroy();
    }
    glReady_ = false;
    if (currentContext && currentContext->isValid()) {
        doneCurrent();
    }
}

void PointCloudView::mousePressEvent(QMouseEvent* event) {
    if (event->button() == Qt::LeftButton) {
        dragging_ = true;
        lastMouse_ = event->pos();
        if (pathPlaying_) {
            pathPlaying_ = false;
            emit pathPlayingChanged(false);
        }
        setCursor(Qt::ClosedHandCursor);
    }
    QOpenGLWidget::mousePressEvent(event);
}

void PointCloudView::mouseMoveEvent(QMouseEvent* event) {
    if (dragging_) {
        const QPoint delta = event->pos() - lastMouse_;
        lastMouse_ = event->pos();
        orbitYaw_ -= static_cast<double>(delta.x()) * 0.006;
        orbitPitch_ = std::clamp(
            orbitPitch_ + static_cast<double>(delta.y()) * 0.006, -1.45, 1.45);
        update();
    }
    QOpenGLWidget::mouseMoveEvent(event);
}

void PointCloudView::wheelEvent(QWheelEvent* event) {
    const double steps = static_cast<double>(event->angleDelta().y()) / 120.0;
    orbitRadius_ *= std::exp(-steps * 0.12);
    const double minimum =
        scene_ ? std::max(0.5, scene_->header().bounds.diagonal() * 0.04) : 0.5;
    const double maximum =
        scene_ ? std::max(20.0, scene_->header().bounds.diagonal() * 10.0) : 1000.0;
    orbitRadius_ = std::clamp(orbitRadius_, minimum, maximum);
    update();
    event->accept();
}
