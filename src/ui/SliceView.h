#pragma once

#include "core/PlaneSampler.h"
#include "ui/Measurement.h"

#include <QImage>
#include <QPointF>
#include <QVector>
#include <QWidget>

namespace microqt {

class SliceView : public QWidget {
    Q_OBJECT

public:
    explicit SliceView(QWidget *parent = nullptr);

    void setVolume(const micro::Volume *volume);
    void setPlane(double centerXUm, double centerYUm, double centerZUm,
                  double tiltXDeg, double tiltYDeg);
    void setInterpolation(micro::Interpolation interpolation);
    void setWindow(float low, float high);
    void setMeasurements(const QVector<Measurement> &measurements);
    void setMeasurementEnabled(bool enabled);
    void refreshGeometry();

    micro::Vec3 planeCenter() const { return m_centerUm; }
    double tiltXDeg() const { return m_tiltXDeg; }
    double tiltYDeg() const { return m_tiltYDeg; }
    double zoom() const { return m_zoom; }
    double halfSpanUm() const { return m_baseHalfSpanUm / m_zoom; }

public slots:
    void fitToVolume();
    void resetView();
    void zoomIn();
    void zoomOut();

signals:
    void planeCenterChanged(const micro::Vec3 &centerUm);
    void measurementCompleted(const micro::Vec3 &aUm, const micro::Vec3 &bUm);
    void viewInfoChanged(const QString &text);
    void zoomChanged(double zoom);

protected:
    void paintEvent(QPaintEvent *event) override;
    void mousePressEvent(QMouseEvent *event) override;
    void mouseMoveEvent(QMouseEvent *event) override;
    void mouseReleaseEvent(QMouseEvent *event) override;
    void wheelEvent(QWheelEvent *event) override;
    void keyPressEvent(QKeyEvent *event) override;
    void resizeEvent(QResizeEvent *event) override;
    void leaveEvent(QEvent *event) override;

private:
    enum class DragMode { None, Measure, Pan };

    void rebuildPlane();
    void renderSlice();
    void updateBaseHalfSpan();
    QRectF imageRect() const;
    QPointF worldToScreen(const micro::Vec3 &world) const;
    micro::Vec3 screenToWorld(const QPointF &screen) const;
    bool screenToPlaneLocal(const QPointF &screen, double *u, double *v) const;
    bool worldOnCurrentPlane(const micro::Vec3 &world, double *u,
                             double *v) const;
    void drawMeasurements(QPainter &painter) const;
    void drawMeasurement(QPainter &painter, const micro::Vec3 &a,
                         const micro::Vec3 &b, const QColor &color,
                         bool provisional) const;
    void drawAxes(QPainter &painter) const;
    void drawScaleBar(QPainter &painter) const;
    double niceScaleLengthUm(double targetUm) const;

    const micro::Volume *m_volume = nullptr;
    micro::SlicePlane m_plane;
    micro::Vec3 m_centerUm{0.0, 0.0, 0.0};
    double m_tiltXDeg = 0.0;
    double m_tiltYDeg = 0.0;
    double m_zoom = 1.0;
    double m_baseHalfSpanUm = 500.0;
    micro::Interpolation m_interpolation = micro::Interpolation::Linear;
    float m_windowLow = 0.0f;
    float m_windowHigh = 1.0f;
    micro::SliceImage m_slice;
    bool m_sliceDirty = true;
    bool m_measurementEnabled = true;
    QVector<Measurement> m_measurements;

    DragMode m_dragMode = DragMode::None;
    QPointF m_lastMouse;
    micro::Vec3 m_dragStartWorld;
    micro::Vec3 m_dragCurrentWorld;
    bool m_hasProvisional = false;
    bool m_cursorInside = false;
    QPointF m_cursor;
};

} // namespace microqt

