#pragma once

#include "core/PlaneSampler.h"
#include "ui/Measurement.h"

#include <QPointF>
#include <QVector>
#include <QWidget>

namespace microqt {

class OverviewView : public QWidget {
    Q_OBJECT

public:
    explicit OverviewView(QWidget *parent = nullptr);

    void setVolume(const micro::Volume *volume);
    void setPlane(const micro::Vec3 &centerUm, double tiltXDeg,
                  double tiltYDeg);
    void setMeasurements(const QVector<Measurement> &measurements);
    void refreshGeometry();

    double yawDeg() const { return m_yawDeg; }
    double pitchDeg() const { return m_pitchDeg; }

public slots:
    void resetOrientation();
    void zoomIn();
    void zoomOut();

signals:
    void viewInfoChanged(const QString &text);
    void orientationChanged(double yawDeg, double pitchDeg);

protected:
    void paintEvent(QPaintEvent *event) override;
    void mousePressEvent(QMouseEvent *event) override;
    void mouseMoveEvent(QMouseEvent *event) override;
    void mouseReleaseEvent(QMouseEvent *event) override;
    void wheelEvent(QWheelEvent *event) override;
    void resizeEvent(QResizeEvent *event) override;

private:
    struct CameraBasis {
        micro::Vec3 right;
        micro::Vec3 up;
        micro::Vec3 forward;
    };

    CameraBasis cameraBasis() const;
    QPointF project(const micro::Vec3 &world, const CameraBasis &camera) const;
    double depth(const micro::Vec3 &world, const CameraBasis &camera) const;
    void updatePlane();
    void drawBox(QPainter &painter, const CameraBasis &camera) const;
    void drawCutPlane(QPainter &painter, const CameraBasis &camera) const;
    void drawMeasurements(QPainter &painter, const CameraBasis &camera) const;
    void drawAxes(QPainter &painter, const CameraBasis &camera) const;
    double scalePixelsPerUm() const;

    const micro::Volume *m_volume = nullptr;
    micro::SlicePlane m_plane;
    micro::Vec3 m_centerUm;
    double m_tiltXDeg = 0.0;
    double m_tiltYDeg = 0.0;
    double m_halfSpanUm = 500.0;
    double m_zoom = 1.0;
    double m_yawDeg = -42.0;
    double m_pitchDeg = 28.0;
    QVector<Measurement> m_measurements;
    QPointF m_lastMouse;
    bool m_rotating = false;
};

} // namespace microqt

