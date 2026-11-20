#include "ui/OverviewView.h"

#include <QMouseEvent>
#include <QPainter>
#include <QPolygonF>
#include <QWheelEvent>

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>

namespace microqt {
namespace {

QColor axisColor(int axis) {
    switch (axis) {
    case 0:
        return QColor(255, 105, 105);
    case 1:
        return QColor(98, 221, 140);
    default:
        return QColor(90, 162, 255);
    }
}

} // namespace

OverviewView::OverviewView(QWidget *parent) : QWidget(parent) {
    setMinimumSize(420, 380);
    setMouseTracking(true);
    setCursor(Qt::OpenHandCursor);
    setStyleSheet(QStringLiteral("background:#0a0e13;"));
}

void OverviewView::setVolume(const micro::Volume *volume) {
    m_volume = volume;
    m_measurements.clear();
    if (m_volume && !m_volume->isEmpty()) {
        m_centerUm = m_volume->geometry().centerUm();
        m_tiltXDeg = 0.0;
        m_tiltYDeg = 0.0;
        m_zoom = 1.0;
        updatePlane();
    }
    update();
}

void OverviewView::setPlane(const micro::Vec3 &centerUm, double tiltXDeg,
                            double tiltYDeg) {
    m_centerUm = centerUm;
    m_tiltXDeg = tiltXDeg;
    m_tiltYDeg = tiltYDeg;
    updatePlane();
    update();
}

void OverviewView::setMeasurements(const QVector<Measurement> &measurements) {
    m_measurements = measurements;
    update();
}

void OverviewView::refreshGeometry() {
    updatePlane();
    update();
}

void OverviewView::updatePlane() {
    if (!m_volume || m_volume->isEmpty()) {
        return;
    }
    const micro::SlicePlane orientation =
        micro::makeTiltedPlane(m_centerUm, m_tiltXDeg, m_tiltYDeg, 1.0, 1.0);
    const micro::Aabb bounds = m_volume->geometry().boundsUm();
    double minU = std::numeric_limits<double>::max();
    double maxU = std::numeric_limits<double>::lowest();
    double minV = std::numeric_limits<double>::max();
    double maxV = std::numeric_limits<double>::lowest();
    for (int corner = 0; corner < 8; ++corner) {
        const micro::Vec3 point{
            (corner & 1) ? bounds.max.x : bounds.min.x,
            (corner & 2) ? bounds.max.y : bounds.min.y,
            (corner & 4) ? bounds.max.z : bounds.min.z};
        minU = std::min(minU, micro::dot(point - m_centerUm, orientation.uAxis));
        maxU = std::max(maxU, micro::dot(point - m_centerUm, orientation.uAxis));
        minV = std::min(minV, micro::dot(point - m_centerUm, orientation.vAxis));
        maxV = std::max(maxV, micro::dot(point - m_centerUm, orientation.vAxis));
    }
    const double span = std::max(maxU - minU, maxV - minV);
    m_halfSpanUm = std::max(20.0, span * 0.5 * 1.08);
    m_plane = micro::makeTiltedPlane(m_centerUm, m_tiltXDeg, m_tiltYDeg,
                                     m_halfSpanUm, m_halfSpanUm);
}

OverviewView::CameraBasis OverviewView::cameraBasis() const {
    const double yaw = micro::degToRad(m_yawDeg);
    const double pitch = micro::degToRad(m_pitchDeg);
    CameraBasis camera;
    camera.right = {std::cos(yaw), std::sin(yaw), 0.0};
    camera.up = {-std::sin(yaw) * std::sin(pitch),
                 std::cos(yaw) * std::sin(pitch), std::cos(pitch)};
    camera.forward = micro::cross(camera.right, camera.up).normalized();
    return camera;
}

double OverviewView::scalePixelsPerUm() const {
    if (!m_volume || m_volume->isEmpty()) {
        return 1.0;
    }
    const double diagonal = std::max(1.0, m_volume->geometry().boundsUm().diagonal());
    return std::min(width(), height()) * 0.72 / diagonal * m_zoom;
}

QPointF OverviewView::project(const micro::Vec3 &world,
                              const CameraBasis &camera) const {
    const micro::Vec3 center =
        m_volume ? m_volume->geometry().boundsUm().center() : micro::Vec3{};
    const micro::Vec3 delta = world - center;
    const double scale = scalePixelsPerUm();
    return {width() * 0.5 + micro::dot(delta, camera.right) * scale,
            height() * 0.5 - micro::dot(delta, camera.up) * scale};
}

double OverviewView::depth(const micro::Vec3 &world,
                           const CameraBasis &camera) const {
    const micro::Vec3 center =
        m_volume ? m_volume->geometry().boundsUm().center() : micro::Vec3{};
    return micro::dot(world - center, camera.forward);
}

void OverviewView::resetOrientation() {
    m_yawDeg = -42.0;
    m_pitchDeg = 28.0;
    m_zoom = 1.0;
    emit orientationChanged(m_yawDeg, m_pitchDeg);
    update();
}

void OverviewView::zoomIn() {
    m_zoom = std::min(5.0, m_zoom * 1.25);
    update();
}

void OverviewView::zoomOut() {
    m_zoom = std::max(0.35, m_zoom / 1.25);
    update();
}

void OverviewView::drawBox(QPainter &painter,
                           const CameraBasis &camera) const {
    if (!m_volume || m_volume->isEmpty()) {
        return;
    }
    const micro::Aabb bounds = m_volume->geometry().boundsUm();
    std::array<micro::Vec3, 8> corners;
    for (int index = 0; index < 8; ++index) {
        corners[index] = {(index & 1) ? bounds.max.x : bounds.min.x,
                          (index & 2) ? bounds.max.y : bounds.min.y,
                          (index & 4) ? bounds.max.z : bounds.min.z};
    }
    constexpr int edges[12][2] = {{0, 1}, {2, 3}, {4, 5}, {6, 7},
                                  {0, 2}, {1, 3}, {4, 6}, {5, 7},
                                  {0, 4}, {1, 5}, {2, 6}, {3, 7}};
    for (const auto &edge : edges) {
        const double edgeDepth =
            (depth(corners[edge[0]], camera) + depth(corners[edge[1]], camera)) *
            0.5;
        const int alpha = edgeDepth >= 0.0 ? 145 : 55;
        painter.setPen(QPen(QColor(115, 139, 158, alpha), 1.25));
        painter.drawLine(project(corners[edge[0]], camera),
                         project(corners[edge[1]], camera));
    }

    QFont font = painter.font();
    font.setPointSizeF(9.0);
    painter.setFont(font);
    painter.setPen(QColor(171, 190, 204));
    const micro::Vec3 xLabel{bounds.max.x, bounds.min.y, bounds.min.z};
    const micro::Vec3 yLabel{bounds.min.x, bounds.max.y, bounds.min.z};
    const micro::Vec3 zLabel{bounds.min.x, bounds.min.y, bounds.max.z};
    painter.drawText(project(xLabel, camera) + QPointF(4, 14),
                     QStringLiteral("X %1 µm").arg(
                         QString::number(bounds.max.x - bounds.min.x, 'f', 0)));
    painter.drawText(project(yLabel, camera) + QPointF(4, 14),
                     QStringLiteral("Y %1 µm").arg(
                         QString::number(bounds.max.y - bounds.min.y, 'f', 0)));
    painter.drawText(project(zLabel, camera) + QPointF(4, -7),
                     QStringLiteral("Z %1 µm").arg(
                         QString::number(bounds.max.z - bounds.min.z, 'f', 0)));
}

void OverviewView::drawCutPlane(QPainter &painter,
                                const CameraBasis &camera) const {
    if (!m_volume || m_volume->isEmpty()) {
        return;
    }
    const int grid = 8;
    const QPointF center = project(m_plane.centerUm, camera);
    QPolygonF quad;
    quad << project(m_plane.pointAt(-m_halfSpanUm, -m_halfSpanUm), camera)
         << project(m_plane.pointAt(m_halfSpanUm, -m_halfSpanUm), camera)
         << project(m_plane.pointAt(m_halfSpanUm, m_halfSpanUm), camera)
         << project(m_plane.pointAt(-m_halfSpanUm, m_halfSpanUm), camera);
    painter.setPen(Qt::NoPen);
    painter.setBrush(QColor(39, 185, 207, 38));
    painter.drawPolygon(quad);

    for (int line = 0; line <= grid; ++line) {
        const double coordinate =
            -m_halfSpanUm + (2.0 * m_halfSpanUm * line / grid);
        painter.setPen(QPen(QColor(86, 212, 226, 52), 0.7));
        painter.drawLine(
            project(m_plane.pointAt(coordinate, -m_halfSpanUm), camera),
            project(m_plane.pointAt(coordinate, m_halfSpanUm), camera));
        painter.drawLine(
            project(m_plane.pointAt(-m_halfSpanUm, coordinate), camera),
            project(m_plane.pointAt(m_halfSpanUm, coordinate), camera));
    }
    painter.setPen(QPen(QColor(94, 225, 240, 220), 2.0));
    painter.setBrush(Qt::NoBrush);
    painter.drawPolygon(quad);
    painter.setBrush(QColor(94, 225, 240));
    painter.drawEllipse(center, 3.2, 3.2);
}

void OverviewView::drawMeasurements(QPainter &painter,
                                    const CameraBasis &camera) const {
    QFont font = painter.font();
    font.setPointSizeF(9.5);
    font.setBold(true);
    painter.setFont(font);
    for (const Measurement &measurement : m_measurements) {
        const QPointF a = project(measurement.aUm, camera);
        const QPointF b = project(measurement.bUm, camera);
        painter.setPen(QPen(QColor(73, 220, 234), 2.0, Qt::SolidLine,
                            Qt::RoundCap));
        painter.setBrush(Qt::NoBrush);
        painter.drawLine(a, b);
        painter.setBrush(QColor(73, 220, 234));
        painter.drawEllipse(a, 3.5, 3.5);
        painter.drawEllipse(b, 3.5, 3.5);
        const QString label =
            QStringLiteral("%1 µm").arg(
                QString::number(measurement.lengthUm(), 'f', 1));
        painter.setPen(QColor(186, 244, 248));
        painter.drawText((a + b) * 0.5 + QPointF(5, -5), label);
    }
}

void OverviewView::drawAxes(QPainter &painter,
                            const CameraBasis &camera) const {
    const QPointF origin(48, height() - 68);
    const micro::Vec3 axes[3] = {{1.0, 0.0, 0.0},
                                 {0.0, 1.0, 0.0},
                                 {0.0, 0.0, 1.0}};
    const QString names[3] = {QStringLiteral("X"), QStringLiteral("Y"),
                              QStringLiteral("Z")};
    QFont font = painter.font();
    font.setPointSizeF(9.0);
    font.setBold(true);
    painter.setFont(font);
    for (int axis = 0; axis < 3; ++axis) {
        const double sx = micro::dot(axes[axis], camera.right);
        const double sy = -micro::dot(axes[axis], camera.up);
        const QPointF end(origin.x() + sx * 30.0, origin.y() + sy * 30.0);
        painter.setPen(QPen(axisColor(axis), 2.2, Qt::SolidLine, Qt::RoundCap));
        painter.drawLine(origin, end);
        painter.drawText(end + QPointF(4, 3), names[axis]);
    }
}

void OverviewView::paintEvent(QPaintEvent *) {
    QPainter painter(this);
    painter.setRenderHint(QPainter::Antialiasing);
    painter.fillRect(rect(), QColor(10, 14, 19));
    if (!m_volume || m_volume->isEmpty()) {
        painter.setPen(QColor(151, 164, 176));
        painter.drawText(rect(), Qt::AlignCenter, QStringLiteral("未载入体数据"));
        return;
    }
    const CameraBasis camera = cameraBasis();
    drawBox(painter, camera);
    drawCutPlane(painter, camera);
    drawMeasurements(painter, camera);
    drawAxes(painter, camera);

    QFont font = painter.font();
    font.setPointSizeF(9.5);
    font.setBold(true);
    painter.setFont(font);
    painter.setPen(QColor(211, 225, 235));
    painter.drawText(QRectF(22, 18, width() - 44, 24),
                     Qt::AlignLeft | Qt::AlignVCenter,
                     QStringLiteral("3D 物理总览  ·  左键拖动旋转"));
    font.setBold(false);
    font.setPointSizeF(9.0);
    painter.setFont(font);
    painter.setPen(QColor(139, 159, 173));
    painter.drawText(
        QRectF(22, 42, width() - 44, 22), Qt::AlignLeft | Qt::AlignVCenter,
        QStringLiteral("相机 yaw %1°  pitch %2°  ·  青色为当前斜切面")
            .arg(QString::number(m_yawDeg, 'f', 1),
                 QString::number(m_pitchDeg, 'f', 1)));
}

void OverviewView::mousePressEvent(QMouseEvent *event) {
    if (event->button() == Qt::LeftButton) {
        m_rotating = true;
        m_lastMouse = event->position();
        setCursor(Qt::ClosedHandCursor);
    }
}

void OverviewView::mouseMoveEvent(QMouseEvent *event) {
    if (!m_rotating) {
        return;
    }
    const QPointF delta = event->position() - m_lastMouse;
    m_lastMouse = event->position();
    m_yawDeg += delta.x() * 0.38;
    m_pitchDeg = micro::clampd(m_pitchDeg + delta.y() * 0.32, -85.0, 85.0);
    emit orientationChanged(m_yawDeg, m_pitchDeg);
    update();
}

void OverviewView::mouseReleaseEvent(QMouseEvent *event) {
    if (event->button() == Qt::LeftButton) {
        m_rotating = false;
        setCursor(Qt::OpenHandCursor);
    }
}

void OverviewView::wheelEvent(QWheelEvent *event) {
    const double steps = event->angleDelta().y() / 120.0;
    m_zoom = micro::clampd(m_zoom * std::pow(1.15, steps), 0.35, 5.0);
    update();
    event->accept();
}

void OverviewView::resizeEvent(QResizeEvent *event) {
    QWidget::resizeEvent(event);
    update();
}

} // namespace microqt

