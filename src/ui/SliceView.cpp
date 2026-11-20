#include "ui/SliceView.h"

#include <QKeyEvent>
#include <QMouseEvent>
#include <QPainter>
#include <QPainterPath>
#include <QWheelEvent>

#include <algorithm>
#include <cmath>
#include <limits>

namespace microqt {
namespace {

QColor axisColor(int axis) {
    switch (axis) {
    case 0:
        return QColor(255, 103, 103);
    case 1:
        return QColor(107, 226, 146);
    default:
        return QColor(102, 168, 255);
    }
}

QString fixed(double value, int decimals = 1) {
    return QString::number(value, 'f', decimals);
}

} // namespace

SliceView::SliceView(QWidget *parent) : QWidget(parent) {
    setMinimumSize(420, 380);
    setFocusPolicy(Qt::StrongFocus);
    setMouseTracking(true);
    setCursor(Qt::CrossCursor);
    setStyleSheet(QStringLiteral("background:#0a0e13;"));
}

void SliceView::setVolume(const micro::Volume *volume) {
    m_volume = volume;
    m_measurements.clear();
    m_hasProvisional = false;
    if (m_volume && !m_volume->isEmpty()) {
        m_centerUm = m_volume->geometry().centerUm();
        m_tiltXDeg = 0.0;
        m_tiltYDeg = 0.0;
        m_zoom = 1.0;
        m_windowLow = m_volume->valueMin();
        m_windowHigh = m_volume->valueMax();
        if (m_windowHigh <= m_windowLow) {
            m_windowHigh = m_windowLow + 1.0f;
        }
        updateBaseHalfSpan();
    }
    m_sliceDirty = true;
    update();
}

void SliceView::setPlane(double centerXUm, double centerYUm, double centerZUm,
                         double tiltXDeg, double tiltYDeg) {
    const micro::Vec3 nextCenter{centerXUm, centerYUm, centerZUm};
    const bool orientationChanged =
        std::abs(tiltXDeg - m_tiltXDeg) > 1e-9 ||
        std::abs(tiltYDeg - m_tiltYDeg) > 1e-9;
    const bool centerChanged = micro::distance(nextCenter, m_centerUm) > 1e-9;
    if (!orientationChanged && !centerChanged) {
        return;
    }
    m_centerUm = nextCenter;
    m_tiltXDeg = tiltXDeg;
    m_tiltYDeg = tiltYDeg;
    if (orientationChanged) {
        updateBaseHalfSpan();
    }
    m_sliceDirty = true;
    update();
}

void SliceView::setInterpolation(micro::Interpolation interpolation) {
    if (m_interpolation == interpolation) {
        return;
    }
    m_interpolation = interpolation;
    m_sliceDirty = true;
    update();
}

void SliceView::setWindow(float low, float high) {
    if (std::abs(low - m_windowLow) < 1e-7f &&
        std::abs(high - m_windowHigh) < 1e-7f) {
        return;
    }
    m_windowLow = low;
    m_windowHigh = high;
    m_sliceDirty = true;
    update();
}

void SliceView::setMeasurements(const QVector<Measurement> &measurements) {
    m_measurements = measurements;
    update();
}

void SliceView::setMeasurementEnabled(bool enabled) {
    m_measurementEnabled = enabled;
    setCursor(enabled ? Qt::CrossCursor : Qt::OpenHandCursor);
}

void SliceView::refreshGeometry() {
    updateBaseHalfSpan();
    m_sliceDirty = true;
    update();
}

void SliceView::fitToVolume() {
    if (!m_volume || m_volume->isEmpty()) {
        return;
    }
    m_centerUm = m_volume->geometry().centerUm();
    m_zoom = 1.0;
    updateBaseHalfSpan();
    m_sliceDirty = true;
    emit planeCenterChanged(m_centerUm);
    emit zoomChanged(m_zoom);
    update();
}

void SliceView::resetView() { fitToVolume(); }

void SliceView::zoomIn() {
    m_zoom = std::min(10.0, m_zoom * 1.25);
    m_sliceDirty = true;
    emit zoomChanged(m_zoom);
    update();
}

void SliceView::zoomOut() {
    m_zoom = std::max(0.25, m_zoom / 1.25);
    m_sliceDirty = true;
    emit zoomChanged(m_zoom);
    update();
}

void SliceView::rebuildPlane() {
    const double half = m_baseHalfSpanUm / m_zoom;
    m_plane = micro::makeTiltedPlane(m_centerUm, m_tiltXDeg, m_tiltYDeg, half,
                                     half);
}

void SliceView::updateBaseHalfSpan() {
    if (!m_volume || m_volume->isEmpty()) {
        m_baseHalfSpanUm = 500.0;
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
        const double u = micro::dot(point - m_centerUm, orientation.uAxis);
        const double v = micro::dot(point - m_centerUm, orientation.vAxis);
        minU = std::min(minU, u);
        maxU = std::max(maxU, u);
        minV = std::min(minV, v);
        maxV = std::max(maxV, v);
    }
    const double span = std::max(maxU - minU, maxV - minV);
    m_baseHalfSpanUm = std::max(20.0, span * 0.5 * 1.08);
}

void SliceView::renderSlice() {
    if (!m_volume || m_volume->isEmpty()) {
        m_slice = {};
        return;
    }
    rebuildPlane();
    constexpr int resolution = 640;
    m_slice = micro::renderPlane(*m_volume, m_plane, resolution, resolution,
                                 m_interpolation, m_windowLow, m_windowHigh);
    m_sliceDirty = false;
    const QString title =
        std::abs(m_tiltXDeg) < 1e-4 && std::abs(m_tiltYDeg) < 1e-4
            ? QStringLiteral("正视 XY")
            : QStringLiteral("斜切面");
    emit viewInfoChanged(
        QStringLiteral("%1  ·  中心 (%2, %3, %4) µm  ·  %5")
            .arg(title, fixed(m_centerUm.x), fixed(m_centerUm.y),
                 fixed(m_centerUm.z),
                 QString::fromUtf8(micro::interpolationDisplayName(m_interpolation))));
}

QRectF SliceView::imageRect() const {
    const double margin = 24.0;
    const double availableW = std::max(1.0, width() - 2.0 * margin);
    const double availableH = std::max(1.0, height() - 2.0 * margin);
    const double side = std::min(availableW, availableH);
    return {(width() - side) * 0.5, (height() - side) * 0.5, side, side};
}

QPointF SliceView::worldToScreen(const micro::Vec3 &world) const {
    const micro::Vec3 delta = world - m_plane.centerUm;
    const double u = micro::dot(delta, m_plane.uAxis);
    const double v = micro::dot(delta, m_plane.vAxis);
    const QRectF area = imageRect();
    return {area.center().x() + u / (2.0 * m_plane.halfWidthUm) * area.width(),
            area.center().y() - v / (2.0 * m_plane.halfHeightUm) * area.height()};
}

bool SliceView::screenToPlaneLocal(const QPointF &screen, double *u,
                                   double *v) const {
    const QRectF area = imageRect();
    if (!area.contains(screen)) {
        return false;
    }
    const double nx = (screen.x() - area.left()) / area.width() * 2.0 - 1.0;
    const double ny = 1.0 - (screen.y() - area.top()) / area.height() * 2.0;
    *u = nx * m_plane.halfWidthUm;
    *v = ny * m_plane.halfHeightUm;
    return true;
}

micro::Vec3 SliceView::screenToWorld(const QPointF &screen) const {
    double u = 0.0;
    double v = 0.0;
    if (!screenToPlaneLocal(screen, &u, &v)) {
        return m_plane.centerUm;
    }
    return m_plane.pointAt(u, v);
}

bool SliceView::worldOnCurrentPlane(const micro::Vec3 &world, double *u,
                                    double *v) const {
    const micro::Vec3 local = m_plane.worldToLocal(world);
    const double tolerance =
        m_volume && !m_volume->isEmpty()
            ? std::max(0.01, m_volume->geometry().spacingUm.z * 0.01)
            : 0.01;
    if (std::abs(local.z) > tolerance) {
        return false;
    }
    *u = local.x;
    *v = local.y;
    return m_plane.containsLocal(local.x, local.y, 1e-6);
}

void SliceView::drawMeasurement(QPainter &painter, const micro::Vec3 &a,
                                const micro::Vec3 &b, const QColor &color,
                                bool provisional) const {
    const QPointF pa = worldToScreen(a);
    const QPointF pb = worldToScreen(b);
    QPen pen(color, provisional ? 1.5 : 2.2, Qt::SolidLine, Qt::RoundCap);
    if (provisional) {
        pen.setStyle(Qt::DashLine);
    }
    painter.setPen(pen);
    painter.setBrush(Qt::NoBrush);
    painter.drawLine(pa, pb);

    painter.setBrush(color);
    painter.setPen(QPen(QColor(8, 13, 18), 1.5));
    painter.drawEllipse(pa, 4.2, 4.2);
    painter.drawEllipse(pb, 4.2, 4.2);

    const double lengthUm = micro::distance(a, b);
    const QString label =
        QStringLiteral("%1 µm").arg(QString::number(lengthUm, 'f', 1));
    const QPointF mid = (pa + pb) * 0.5;
    QFont font = painter.font();
    font.setPointSizeF(10.5);
    font.setBold(true);
    painter.setFont(font);
    const QFontMetricsF metrics(font);
    QRectF textRect = metrics.boundingRect(label).adjusted(-8, -4, 8, 4);
    textRect.moveCenter(mid + QPointF(0, -15));
    painter.setPen(Qt::NoPen);
    painter.setBrush(QColor(5, 10, 15, 225));
    painter.drawRoundedRect(textRect, 4, 4);
    painter.setPen(color);
    painter.drawText(textRect, Qt::AlignCenter, label);
}

void SliceView::drawMeasurements(QPainter &painter) const {
    for (const Measurement &measurement : m_measurements) {
        double au = 0.0;
        double av = 0.0;
        double bu = 0.0;
        double bv = 0.0;
        if (worldOnCurrentPlane(measurement.aUm, &au, &av) &&
            worldOnCurrentPlane(measurement.bUm, &bu, &bv)) {
            drawMeasurement(painter, measurement.aUm, measurement.bUm,
                            QColor(74, 222, 235), false);
        }
    }
    if (m_hasProvisional) {
        drawMeasurement(painter, m_dragStartWorld, m_dragCurrentWorld,
                        QColor(255, 191, 79), true);
    }
}

void SliceView::drawAxes(QPainter &painter) const {
    const QRectF area = imageRect();
    const QPointF origin(area.right() - 58.0, area.top() + 54.0);
    const QString names[3] = {QStringLiteral("X"), QStringLiteral("Y"),
                              QStringLiteral("Z")};
    const micro::Vec3 axes[3] = {{1.0, 0.0, 0.0},
                                 {0.0, 1.0, 0.0},
                                 {0.0, 0.0, 1.0}};
    painter.save();
    painter.setRenderHint(QPainter::Antialiasing);
    QFont font = painter.font();
    font.setPointSizeF(9.0);
    font.setBold(true);
    painter.setFont(font);
    for (int axis = 0; axis < 3; ++axis) {
        const double su = micro::dot(axes[axis], m_plane.uAxis);
        const double sv = -micro::dot(axes[axis], m_plane.vAxis);
        const double projectedLength = std::hypot(su, sv);
        painter.setPen(QPen(axisColor(axis), 2.0, Qt::SolidLine, Qt::RoundCap));
        if (projectedLength < 0.08) {
            painter.setBrush(axisColor(axis));
            painter.drawEllipse(origin, 3.4, 3.4);
            painter.drawText(origin + QPointF(7, 4), names[axis] + QStringLiteral("⊙"));
            continue;
        }
        const double angle = std::atan2(sv, su);
        const QPointF end(origin.x() + std::cos(angle) * 29.0,
                          origin.y() + std::sin(angle) * 29.0);
        painter.drawLine(origin, end);
        const QPointF back(end.x() - std::cos(angle) * 6.0,
                           end.y() - std::sin(angle) * 6.0);
        painter.drawLine(end, back + QPointF(-std::sin(angle) * 2.5,
                                             std::cos(angle) * 2.5));
        painter.drawLine(end, back + QPointF(std::sin(angle) * 2.5,
                                             -std::cos(angle) * 2.5));
        painter.drawText(end + QPointF(4, 3), names[axis]);
    }
    painter.restore();
}

double SliceView::niceScaleLengthUm(double targetUm) const {
    if (targetUm <= 0.0) {
        return 1.0;
    }
    const double exponent = std::floor(std::log10(targetUm));
    const double base = std::pow(10.0, exponent);
    const double fraction = targetUm / base;
    double nice = 1.0;
    if (fraction >= 5.0) {
        nice = 5.0;
    } else if (fraction >= 2.0) {
        nice = 2.0;
    }
    return nice * base;
}

void SliceView::drawScaleBar(QPainter &painter) const {
    const QRectF area = imageRect();
    const double desired = (m_plane.halfWidthUm * 2.0) * 0.22;
    const double lengthUm = niceScaleLengthUm(desired);
    const double pixelLength =
        lengthUm / (m_plane.halfWidthUm * 2.0) * area.width();
    const QPointF start(area.left() + 18.0, area.bottom() - 22.0);
    const QPointF end = start + QPointF(pixelLength, 0.0);
    painter.save();
    painter.setRenderHint(QPainter::Antialiasing);
    painter.setPen(QPen(QColor(235, 241, 247), 3.0, Qt::SolidLine, Qt::FlatCap));
    painter.drawLine(start, end);
    painter.drawLine(start + QPointF(0, -4), start + QPointF(0, 4));
    painter.drawLine(end + QPointF(0, -4), end + QPointF(0, 4));
    QFont font = painter.font();
    font.setPointSizeF(9.5);
    painter.setFont(font);
    painter.setPen(QColor(235, 241, 247));
    painter.drawText(QRectF(start.x(), start.y() - 25, pixelLength + 40, 20),
                     Qt::AlignLeft | Qt::AlignVCenter,
                     QStringLiteral("%1 µm").arg(QString::number(lengthUm, 'f', 0)));
    painter.restore();
}

void SliceView::paintEvent(QPaintEvent *) {
    if (m_sliceDirty) {
        renderSlice();
    }
    QPainter painter(this);
    painter.setRenderHint(QPainter::Antialiasing);
    painter.setRenderHint(QPainter::SmoothPixmapTransform);
    painter.fillRect(rect(), QColor(10, 14, 19));
    if (!m_volume || m_volume->isEmpty() || m_slice.width == 0) {
        painter.setPen(QColor(151, 164, 176));
        painter.drawText(rect(), Qt::AlignCenter, QStringLiteral("未载入体数据"));
        return;
    }

    const QRectF area = imageRect();
    const QImage image(m_slice.rgba.data(), m_slice.width, m_slice.height,
                       m_slice.width * 4, QImage::Format_RGBA8888);
    painter.fillRect(area.adjusted(-1, -1, 1, 1), QColor(33, 45, 57));
    painter.drawImage(area, image);
    painter.setPen(QPen(QColor(71, 89, 104), 1.0));
    painter.setBrush(Qt::NoBrush);
    painter.drawRect(area);

    QFont titleFont = painter.font();
    titleFont.setPointSizeF(9.5);
    titleFont.setBold(true);
    painter.setFont(titleFont);
    const QString title =
        std::abs(m_tiltXDeg) < 1e-4 && std::abs(m_tiltYDeg) < 1e-4
            ? QStringLiteral("正视 XY  ·  物理比例")
            : QStringLiteral("斜切面  ·  X %1°  Y %2°")
                  .arg(QString::number(m_tiltXDeg, 'f', 1),
                       QString::number(m_tiltYDeg, 'f', 1));
    const QRectF titleRect(area.left() + 12, area.top() + 10,
                           area.width() - 110, 26);
    painter.setPen(Qt::NoPen);
    painter.setBrush(QColor(5, 9, 14, 190));
    painter.drawRoundedRect(titleRect.adjusted(-4, -2, 4, 2), 5, 5);
    painter.setPen(QColor(218, 228, 236));
    painter.drawText(titleRect, Qt::AlignLeft | Qt::AlignVCenter, title);

    drawMeasurements(painter);
    drawAxes(painter);
    drawScaleBar(painter);

    if (m_cursorInside) {
        const micro::Vec3 world = screenToWorld(m_cursor);
        const micro::Vec3 local = m_plane.worldToLocal(world);
        const bool inside =
            m_volume->containsWorld(world) && std::abs(local.x) <= m_plane.halfWidthUm &&
            std::abs(local.y) <= m_plane.halfHeightUm;
        if (inside) {
            const QString coordinates =
                QStringLiteral("u %1  v %2 µm").arg(
                    QString::number(local.x, 'f', 1),
                    QString::number(local.y, 'f', 1));
            painter.setPen(QColor(173, 190, 203));
            painter.setFont(titleFont);
            painter.drawText(area.adjusted(14, 0, -14, -8),
                             Qt::AlignRight | Qt::AlignBottom, coordinates);
        }
    }
}

void SliceView::mousePressEvent(QMouseEvent *event) {
    setFocus();
    m_lastMouse = event->position();
    if (event->button() == Qt::LeftButton &&
        imageRect().contains(event->position())) {
        if (m_measurementEnabled) {
            m_dragMode = DragMode::Measure;
            m_dragStartWorld = screenToWorld(event->position());
            m_dragCurrentWorld = m_dragStartWorld;
            m_hasProvisional = true;
            update();
            return;
        }
        m_dragMode = DragMode::Pan;
        setCursor(Qt::ClosedHandCursor);
        return;
    }
    if (event->button() == Qt::RightButton ||
        event->button() == Qt::MiddleButton) {
        m_dragMode = DragMode::Pan;
        setCursor(Qt::ClosedHandCursor);
    }
}

void SliceView::mouseMoveEvent(QMouseEvent *event) {
    m_cursor = event->position();
    m_cursorInside = imageRect().contains(m_cursor);
    if (m_dragMode == DragMode::Measure && m_hasProvisional) {
        m_dragCurrentWorld = screenToWorld(event->position());
        update();
        return;
    }
    if (m_dragMode == DragMode::Pan) {
        const QPointF delta = event->position() - m_lastMouse;
        const QRectF area = imageRect();
        const double du =
            delta.x() / area.width() * 2.0 * m_plane.halfWidthUm;
        const double dv =
            delta.y() / area.height() * 2.0 * m_plane.halfHeightUm;
        m_centerUm += m_plane.uAxis * (-du) + m_plane.vAxis * dv;
        m_lastMouse = event->position();
        m_sliceDirty = true;
        emit planeCenterChanged(m_centerUm);
        update();
        return;
    }
    update();
}

void SliceView::mouseReleaseEvent(QMouseEvent *event) {
    if (event->button() == Qt::LeftButton &&
        m_dragMode == DragMode::Measure) {
        m_dragMode = DragMode::None;
        m_hasProvisional = false;
        m_dragCurrentWorld = screenToWorld(event->position());
        if (m_volume && micro::distance(m_dragStartWorld, m_dragCurrentWorld) >
                            0.05) {
            emit measurementCompleted(m_dragStartWorld, m_dragCurrentWorld);
        }
        update();
        return;
    }
    if (event->button() == Qt::RightButton ||
        event->button() == Qt::MiddleButton ||
        (event->button() == Qt::LeftButton && m_dragMode == DragMode::Pan)) {
        m_dragMode = DragMode::None;
        setCursor(m_measurementEnabled ? Qt::CrossCursor : Qt::OpenHandCursor);
        update();
    }
}

void SliceView::wheelEvent(QWheelEvent *event) {
    if (!m_volume || m_volume->isEmpty()) {
        return;
    }
    rebuildPlane();
    const QPointF cursor = event->position();
    const micro::Vec3 before = screenToWorld(cursor);
    const double steps = event->angleDelta().y() / 120.0;
    m_zoom = micro::clampd(m_zoom * std::pow(1.18, steps), 0.25, 10.0);
    rebuildPlane();
    const micro::Vec3 after = screenToWorld(cursor);
    m_centerUm += before - after;
    m_sliceDirty = true;
    emit planeCenterChanged(m_centerUm);
    emit zoomChanged(m_zoom);
    update();
    event->accept();
}

void SliceView::keyPressEvent(QKeyEvent *event) {
    if (event->key() == Qt::Key_Plus || event->key() == Qt::Key_Equal) {
        zoomIn();
        return;
    }
    if (event->key() == Qt::Key_Minus) {
        zoomOut();
        return;
    }
    if (event->key() == Qt::Key_0) {
        fitToVolume();
        return;
    }
    QWidget::keyPressEvent(event);
}

void SliceView::resizeEvent(QResizeEvent *event) {
    QWidget::resizeEvent(event);
    update();
}

void SliceView::leaveEvent(QEvent *event) {
    m_cursorInside = false;
    update();
    QWidget::leaveEvent(event);
}

} // namespace microqt

