#include "ui/MainWindow.h"

#include "core/Calibration.h"
#include "core/Phantom.h"
#include "io/VolumeIO.h"
#include "ui/OverviewView.h"
#include "ui/SliceView.h"

#include <QAction>
#include <QAbstractItemView>
#include <QApplication>
#include <QCheckBox>
#include <QComboBox>
#include <QDialog>
#include <QDialogButtonBox>
#include <QDoubleSpinBox>
#include <QFile>
#include <QFileDialog>
#include <QFileInfo>
#include <QFormLayout>
#include <QGridLayout>
#include <QGroupBox>
#include <QHeaderView>
#include <QHBoxLayout>
#include <QLabel>
#include <QMenu>
#include <QMenuBar>
#include <QMessageBox>
#include <QPlainTextEdit>
#include <QPushButton>
#include <QScrollArea>
#include <QSplitter>
#include <QStatusBar>
#include <QTableWidget>
#include <QTableWidgetItem>
#include <QTabWidget>
#include <QTextBrowser>
#include <QTextStream>
#include <QToolBar>
#include <QVBoxLayout>

#include <algorithm>
#include <array>

namespace microqt {
namespace {

QDoubleSpinBox *makeSpinBox(QWidget *parent, const QString &suffix,
                            double minimum, double maximum, double step,
                            int decimals) {
    auto *spin = new QDoubleSpinBox(parent);
    spin->setRange(minimum, maximum);
    spin->setSingleStep(step);
    spin->setDecimals(decimals);
    spin->setSuffix(suffix);
    spin->setKeyboardTracking(false);
    spin->setAccelerated(true);
    return spin;
}

QString vectorText(const micro::Vec3 &value, int decimals = 1) {
    return QStringLiteral("%1, %2, %3")
        .arg(QString::number(value.x, 'f', decimals),
             QString::number(value.y, 'f', decimals),
             QString::number(value.z, 'f', decimals));
}

} // namespace

MainWindow::MainWindow(QWidget *parent) : QMainWindow(parent) {
    setWindowTitle(QStringLiteral("MicroSlice 3D · 显微切片物理测量"));
    resize(1440, 900);
    setMinimumSize(1040, 680);
    buildActions();
    buildUi();
    applyStyle();
    loadCalibrationPhantom();
}

MainWindow::~MainWindow() = default;

void MainWindow::buildActions() {
    m_openAction = new QAction(QStringLiteral("打开切片堆栈…"), this);
    m_openAction->setShortcut(QKeySequence::Open);
    connect(m_openAction, &QAction::triggered, this, &MainWindow::openImageStack);

    m_demoAction = new QAction(QStringLiteral("校准体模"), this);
    connect(m_demoAction, &QAction::triggered, this,
            &MainWindow::loadCalibrationPhantom);

    m_frontAction = new QAction(QStringLiteral("正视 XY"), this);
    m_frontAction->setShortcut(QKeySequence(QStringLiteral("Ctrl+1")));
    connect(m_frontAction, &QAction::triggered, this, &MainWindow::setFrontView);

    m_overviewAction = new QAction(QStringLiteral("3D 总览"), this);
    m_overviewAction->setShortcut(QKeySequence(QStringLiteral("Ctrl+3")));
    connect(m_overviewAction, &QAction::triggered, this,
            &MainWindow::showOverview);

    m_fitAction = new QAction(QStringLiteral("适应窗口"), this);
    m_fitAction->setShortcut(QKeySequence(QStringLiteral("F")));
    connect(m_fitAction, &QAction::triggered, this, &MainWindow::fitCurrentView);

    m_reportAction = new QAction(QStringLiteral("校准报告"), this);
    m_reportAction->setShortcut(QKeySequence(QStringLiteral("Ctrl+R")));
    connect(m_reportAction, &QAction::triggered, this,
            &MainWindow::showCalibrationReport);

    m_exportAction = new QAction(QStringLiteral("导出视图"), this);
    m_exportAction->setShortcut(QKeySequence(QStringLiteral("Ctrl+E")));
    connect(m_exportAction, &QAction::triggered, this,
            &MainWindow::exportCurrentView);

    m_clearAction = new QAction(QStringLiteral("清空测量"), this);
    connect(m_clearAction, &QAction::triggered, this,
            &MainWindow::clearMeasurements);

    auto *fileMenu = menuBar()->addMenu(QStringLiteral("文件"));
    fileMenu->addAction(m_openAction);
    fileMenu->addAction(m_demoAction);
    fileMenu->addSeparator();
    fileMenu->addAction(m_exportAction);
    fileMenu->addSeparator();
    fileMenu->addAction(QStringLiteral("退出"), qApp, &QApplication::quit);

    auto *viewMenu = menuBar()->addMenu(QStringLiteral("视图"));
    viewMenu->addAction(m_frontAction);
    viewMenu->addAction(m_overviewAction);
    viewMenu->addAction(m_fitAction);

    auto *analysisMenu = menuBar()->addMenu(QStringLiteral("分析"));
    analysisMenu->addAction(m_reportAction);
    analysisMenu->addAction(m_clearAction);

    auto *toolbar = addToolBar(QStringLiteral("主工具栏"));
    toolbar->setObjectName(QStringLiteral("mainToolbar"));
    toolbar->setMovable(false);
    toolbar->setToolButtonStyle(Qt::ToolButtonTextOnly);
    toolbar->addAction(m_openAction);
    toolbar->addAction(m_demoAction);
    toolbar->addSeparator();
    toolbar->addAction(m_frontAction);
    toolbar->addAction(m_overviewAction);
    toolbar->addAction(m_fitAction);
    toolbar->addSeparator();
    toolbar->addAction(m_reportAction);
    toolbar->addAction(m_exportAction);
}

void MainWindow::buildUi() {
    auto *central = new QWidget(this);
    auto *rootLayout = new QHBoxLayout(central);
    rootLayout->setContentsMargins(0, 0, 0, 0);
    rootLayout->setSpacing(0);

    auto *scroll = new QScrollArea(central);
    scroll->setObjectName(QStringLiteral("controlScroll"));
    scroll->setWidgetResizable(true);
    scroll->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    scroll->setFixedWidth(346);
    auto *panel = new QWidget(scroll);
    panel->setObjectName(QStringLiteral("controlPanel"));
    auto *panelLayout = new QVBoxLayout(panel);
    panelLayout->setContentsMargins(16, 18, 16, 20);
    panelLayout->setSpacing(11);

    auto *brand = new QLabel(QStringLiteral(
        "<div style='font-size:20px;font-weight:700;letter-spacing:1px;'>"
        "MICROSLICE <span style='color:#62dce8;'>3D</span></div>"
        "<div style='color:#8fa3b4;font-size:11px;margin-top:2px;'>"
        "各向异性显微切片 · 物理坐标测量</div>"));
    panelLayout->addWidget(brand);

    auto *dataGroup = new QGroupBox(QStringLiteral("体数据"), panel);
    auto *dataLayout = new QVBoxLayout(dataGroup);
    dataLayout->setSpacing(8);
    m_sourceLabel = new QLabel(dataGroup);
    m_sourceLabel->setObjectName(QStringLiteral("sourceLabel"));
    m_sourceLabel->setWordWrap(true);
    m_volumeInfoLabel = new QLabel(dataGroup);
    m_volumeInfoLabel->setObjectName(QStringLiteral("volumeInfo"));
    m_volumeInfoLabel->setWordWrap(true);
    dataLayout->addWidget(m_sourceLabel);
    dataLayout->addWidget(m_volumeInfoLabel);

    auto *spacingGrid = new QGridLayout();
    spacingGrid->setHorizontalSpacing(7);
    spacingGrid->setVerticalSpacing(6);
    const QString spacingLabels[3] = {QStringLiteral("X 像素"), QStringLiteral("Y 像素"),
                                      QStringLiteral("Z 层厚")};
    const double spacingDefaults[3] = {5.0, 7.5, 12.0};
    for (int index = 0; index < 3; ++index) {
        m_spacingSpins[index] =
            makeSpinBox(dataGroup, QStringLiteral(" µm"), 0.001, 1000.0, 0.1, 3);
        m_spacingSpins[index]->setValue(spacingDefaults[index]);
        spacingGrid->addWidget(new QLabel(spacingLabels[index], dataGroup), index, 0);
        spacingGrid->addWidget(m_spacingSpins[index], index, 1);
        connect(m_spacingSpins[index],
                qOverload<double>(&QDoubleSpinBox::valueChanged), this,
                &MainWindow::applySpacingControls);
    }
    dataLayout->addLayout(spacingGrid);

    m_interpolationCombo = new QComboBox(dataGroup);
    m_interpolationCombo->addItem(QStringLiteral("最近邻"),
                                  static_cast<int>(micro::Interpolation::Nearest));
    m_interpolationCombo->addItem(QStringLiteral("三线性"),
                                  static_cast<int>(micro::Interpolation::Linear));
    m_interpolationCombo->addItem(QStringLiteral("Catmull-Rom 三立方"),
                                  static_cast<int>(micro::Interpolation::Cubic));
    m_interpolationCombo->setCurrentIndex(1);
    connect(m_interpolationCombo, &QComboBox::currentIndexChanged, this,
            &MainWindow::updateInterpolation);
    auto *interpRow = new QHBoxLayout();
    interpRow->addWidget(new QLabel(QStringLiteral("插值"), dataGroup));
    interpRow->addWidget(m_interpolationCombo, 1);
    dataLayout->addLayout(interpRow);
    panelLayout->addWidget(dataGroup);

    auto *planeGroup = new QGroupBox(QStringLiteral("切片与方位"), panel);
    auto *planeLayout = new QVBoxLayout(planeGroup);
    planeLayout->setSpacing(8);
    auto *centerGrid = new QGridLayout();
    const QString centerLabels[3] = {QStringLiteral("中心 X"), QStringLiteral("中心 Y"),
                                     QStringLiteral("中心 Z")};
    for (int index = 0; index < 3; ++index) {
        m_centerSpins[index] =
            makeSpinBox(planeGroup, QStringLiteral(" µm"), -100000.0,
                        100000.0, 10.0, 2);
        centerGrid->addWidget(new QLabel(centerLabels[index], planeGroup), index, 0);
        centerGrid->addWidget(m_centerSpins[index], index, 1);
        connect(m_centerSpins[index],
                qOverload<double>(&QDoubleSpinBox::valueChanged), this,
                &MainWindow::applyPlaneControls);
    }
    planeLayout->addLayout(centerGrid);
    auto *tiltGrid = new QGridLayout();
    const QString tiltLabels[2] = {QStringLiteral("绕 X 倾斜"),
                                   QStringLiteral("绕 Y 倾斜")};
    for (int index = 0; index < 2; ++index) {
        m_tiltSpins[index] =
            makeSpinBox(planeGroup, QStringLiteral(" °"), -90.0, 90.0, 1.0, 2);
        tiltGrid->addWidget(new QLabel(tiltLabels[index], planeGroup), index, 0);
        tiltGrid->addWidget(m_tiltSpins[index], index, 1);
        connect(m_tiltSpins[index],
                qOverload<double>(&QDoubleSpinBox::valueChanged), this,
                &MainWindow::applyPlaneControls);
    }
    planeLayout->addLayout(tiltGrid);
    auto *planeButtons = new QHBoxLayout();
    auto *frontButton = new QPushButton(QStringLiteral("正视 XY"), planeGroup);
    auto *centerButton = new QPushButton(QStringLiteral("体中心"), planeGroup);
    planeButtons->addWidget(frontButton);
    planeButtons->addWidget(centerButton);
    planeLayout->addLayout(planeButtons);
    connect(frontButton, &QPushButton::clicked, this, &MainWindow::setFrontView);
    connect(centerButton, &QPushButton::clicked, this, &MainWindow::fitCurrentView);
    auto *hint = new QLabel(
        QStringLiteral("右键拖动平移 · 滚轮缩放\n正交/斜切/旋转均使用 µm 物理坐标"),
        planeGroup);
    hint->setObjectName(QStringLiteral("hintLabel"));
    hint->setWordWrap(true);
    planeLayout->addWidget(hint);
    panelLayout->addWidget(planeGroup);

    auto *measureGroup = new QGroupBox(QStringLiteral("物理距离测量"), panel);
    auto *measureLayout = new QVBoxLayout(measureGroup);
    m_measurementMode = new QCheckBox(QStringLiteral("测量模式（左键拖拽）"),
                                      measureGroup);
    m_measurementMode->setChecked(true);
    connect(m_measurementMode, &QCheckBox::toggled, this, [this](bool checked) {
        if (m_sliceView) {
            m_sliceView->setMeasurementEnabled(checked);
        }
    });
    measureLayout->addWidget(m_measurementMode);
    auto *measureActions = new QHBoxLayout();
    auto *deleteButton = new QPushButton(QStringLiteral("删除选中"), measureGroup);
    auto *clearButton = new QPushButton(QStringLiteral("清空"), measureGroup);
    measureActions->addWidget(deleteButton);
    measureActions->addWidget(clearButton);
    measureLayout->addLayout(measureActions);
    connect(deleteButton, &QPushButton::clicked, this,
            &MainWindow::deleteSelectedMeasurements);
    connect(clearButton, &QPushButton::clicked, this,
            &MainWindow::clearMeasurements);
    panelLayout->addWidget(measureGroup);

    auto *calibrationGroup = new QGroupBox(QStringLiteral("校准与误差"), panel);
    auto *calibrationLayout = new QVBoxLayout(calibrationGroup);
    m_calibrationLabel = new QLabel(
        QStringLiteral("球 Ø320 µm · 标记距 700 µm\n倾角 35° · 薄杆 Ø30 µm"),
        calibrationGroup);
    m_calibrationLabel->setObjectName(QStringLiteral("hintLabel"));
    calibrationLayout->addWidget(m_calibrationLabel);
    auto *reportButton = new QPushButton(QStringLiteral("生成插值对比报告"),
                                         calibrationGroup);
    reportButton->setObjectName(QStringLiteral("primaryButton"));
    calibrationLayout->addWidget(reportButton);
    connect(reportButton, &QPushButton::clicked, this,
            &MainWindow::showCalibrationReport);
    panelLayout->addWidget(calibrationGroup);
    panelLayout->addStretch(1);

    scroll->setWidget(panel);
    rootLayout->addWidget(scroll);

    auto *rightSplitter = new QSplitter(Qt::Vertical, central);
    rightSplitter->setObjectName(QStringLiteral("rightSplitter"));
    m_tabs = new QTabWidget(rightSplitter);
    m_tabs->setDocumentMode(true);
    m_sliceView = new SliceView(m_tabs);
    m_overviewView = new OverviewView(m_tabs);
    m_tabs->addTab(m_sliceView, QStringLiteral("§ 切片 · 斜切测量"));
    m_tabs->addTab(m_overviewView, QStringLiteral("◇ 3D 旋转总览"));

    auto *measurementPanel = new QGroupBox(QStringLiteral("测量记录"), rightSplitter);
    auto *measurementLayout = new QVBoxLayout(measurementPanel);
    measurementLayout->setContentsMargins(10, 8, 10, 10);
    m_measurementTable = new QTableWidget(measurementPanel);
    m_measurementTable->setColumnCount(5);
    m_measurementTable->setHorizontalHeaderLabels(
        {QStringLiteral("长度 (µm)"), QStringLiteral("ΔX (µm)"),
         QStringLiteral("ΔY (µm)"), QStringLiteral("ΔZ (µm)"),
         QStringLiteral("相对 XY 倾角")});
    m_measurementTable->horizontalHeader()->setSectionResizeMode(
        QHeaderView::Stretch);
    m_measurementTable->verticalHeader()->setVisible(false);
    m_measurementTable->setSelectionBehavior(QAbstractItemView::SelectRows);
    m_measurementTable->setSelectionMode(QAbstractItemView::ExtendedSelection);
    m_measurementTable->setEditTriggers(QAbstractItemView::NoEditTriggers);
    m_measurementTable->setAlternatingRowColors(true);
    measurementLayout->addWidget(m_measurementTable);
    rightSplitter->addWidget(m_tabs);
    rightSplitter->addWidget(measurementPanel);
    rightSplitter->setStretchFactor(0, 5);
    rightSplitter->setStretchFactor(1, 1);
    rightSplitter->setSizes({680, 150});
    rootLayout->addWidget(rightSplitter, 1);

    setCentralWidget(central);

    connect(m_sliceView, &SliceView::planeCenterChanged, this,
            &MainWindow::onPlaneCenterChanged);
    connect(m_sliceView, &SliceView::measurementCompleted, this,
            &MainWindow::addMeasurement);
    connect(m_sliceView, &SliceView::zoomChanged, this,
            &MainWindow::onZoomChanged);
    connect(m_sliceView, &SliceView::viewInfoChanged, this,
            &MainWindow::onViewInfoChanged);
    connect(m_overviewView, &OverviewView::viewInfoChanged, this,
            &MainWindow::onOverviewInfoChanged);
    connect(m_tabs, &QTabWidget::currentChanged, this, [this](int) {
        m_sliceView->setFocus();
    });

    m_zoomLabel = new QLabel(QStringLiteral("100%"), this);
    m_zoomLabel->setObjectName(QStringLiteral("zoomLabel"));
    statusBar()->addPermanentWidget(m_zoomLabel);
    statusBar()->showMessage(QStringLiteral("就绪"));
}

void MainWindow::applyStyle() {
    setStyleSheet(QStringLiteral(R"(
        QMainWindow, QWidget {
            background: #0d1319;
            color: #d9e5ee;
            font-family: "Noto Sans CJK SC", "Noto Sans SC", "Ubuntu Sans", "DejaVu Sans";
            font-size: 12px;
        }
        QMenuBar {
            background: #0b1015;
            border-bottom: 1px solid #202c37;
            padding: 2px;
        }
        QMenuBar::item { padding: 5px 10px; border-radius: 4px; }
        QMenuBar::item:selected { background: #1b2833; }
        QMenu {
            background: #121b23;
            border: 1px solid #2a3946;
            padding: 5px;
        }
        QMenu::item { padding: 6px 26px 6px 18px; border-radius: 4px; }
        QMenu::item:selected { background: #214152; color: #ffffff; }
        QToolBar#mainToolbar {
            background: #101820;
            border: none;
            border-bottom: 1px solid #24313c;
            spacing: 5px;
            padding: 6px 10px;
        }
        QToolBar QToolButton {
            background: transparent;
            color: #c7d7e3;
            border: 1px solid transparent;
            border-radius: 5px;
            padding: 6px 10px;
            font-weight: 600;
        }
        QToolBar QToolButton:hover { background: #1b2a35; border-color: #304553; }
        QToolBar QToolButton:pressed { background: #244253; }
        QToolBar::separator { background: #2a3945; width: 1px; margin: 4px 7px; }
        QScrollArea#controlScroll { border: none; background: #10171e; }
        QWidget#controlPanel { background: #10171e; }
        QGroupBox {
            background: #121b23;
            border: 1px solid #263542;
            border-radius: 8px;
            margin-top: 12px;
            padding: 13px 10px 10px 10px;
            font-weight: 600;
        }
        QGroupBox::title {
            subcontrol-origin: margin;
            left: 11px;
            top: 1px;
            padding: 0 5px;
            color: #9eb3c4;
            background: #10171e;
        }
        QLabel#sourceLabel {
            color: #69dbe7;
            font-weight: 600;
            font-size: 12px;
        }
        QLabel#volumeInfo { color: #91a6b8; font-size: 11px; line-height: 1.4; }
        QLabel#hintLabel { color: #8297a9; font-size: 10.5px; }
        QLabel#zoomLabel {
            color: #8fa8ba;
            padding: 0 10px;
            font-size: 11px;
        }
        QDoubleSpinBox, QComboBox {
            background: #0b1218;
            border: 1px solid #2a3a48;
            border-radius: 4px;
            padding: 4px 6px;
            min-height: 20px;
            color: #d8e6ef;
            selection-background-color: #256177;
        }
        QDoubleSpinBox:focus, QComboBox:focus { border-color: #49b9ca; }
        QDoubleSpinBox::up-button, QDoubleSpinBox::down-button { width: 15px; }
        QComboBox::drop-down { border: none; width: 20px; }
        QComboBox QAbstractItemView {
            background: #121b23;
            border: 1px solid #314553;
            selection-background-color: #245166;
        }
        QPushButton {
            background: #192632;
            border: 1px solid #304453;
            border-radius: 5px;
            padding: 6px 10px;
            color: #d3e1eb;
            font-weight: 600;
        }
        QPushButton:hover { background: #223544; border-color: #436174; }
        QPushButton:pressed { background: #2a4759; }
        QPushButton#primaryButton {
            background: #194954;
            border-color: #318a99;
            color: #d9fbff;
        }
        QPushButton#primaryButton:hover { background: #21616e; }
        QCheckBox { spacing: 7px; }
        QCheckBox::indicator {
            width: 14px; height: 14px;
            border: 1px solid #3d5362;
            border-radius: 3px;
            background: #0b1218;
        }
        QCheckBox::indicator:checked {
            background: #38aebe;
            border-color: #68d5e2;
        }
        QTabWidget::pane { border: none; background: #0a0e13; }
        QTabBar::tab {
            background: #121a22;
            color: #8da2b4;
            border: 1px solid #25343f;
            border-bottom: none;
            padding: 8px 18px;
            margin-right: 3px;
            border-top-left-radius: 6px;
            border-top-right-radius: 6px;
            font-weight: 600;
        }
        QTabBar::tab:selected {
            background: #172833;
            color: #dff7fa;
            border-color: #316171;
            border-bottom: 2px solid #52cddd;
        }
        QTableWidget {
            background: #0e151c;
            alternate-background-color: #111b23;
            border: 1px solid #263642;
            border-radius: 5px;
            gridline-color: #22313c;
            selection-background-color: #214b5c;
            selection-color: #ffffff;
        }
        QHeaderView::section {
            background: #16222c;
            color: #9db2c2;
            border: none;
            border-right: 1px solid #263642;
            padding: 5px;
            font-weight: 600;
        }
        QStatusBar {
            background: #0b1116;
            color: #8da2b3;
            border-top: 1px solid #202c36;
        }
        QScrollBar:vertical { background: #0d141b; width: 9px; }
        QScrollBar::handle:vertical {
            background: #2b3d4a; min-height: 24px; border-radius: 4px;
        }
        QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height: 0; }
        QSplitter::handle { background: #1a252e; }
        QDialog { background: #0f161d; }
        QTextBrowser, QPlainTextEdit {
            background: #0b1218;
            border: 1px solid #2a3c48;
            color: #d6e4ed;
            selection-background-color: #245166;
        }
    )"));
}

void MainWindow::installVolume(std::unique_ptr<micro::Volume> volume,
                               const QString &sourceText,
                               const QString &calibrationHint) {
    if (!volume || volume->isEmpty()) {
        return;
    }
    m_volume = std::move(volume);
    m_sourceText = sourceText;
    m_calibrationHint = calibrationHint;
    m_measurements.clear();
    m_sliceView->setVolume(m_volume.get());
    m_overviewView->setVolume(m_volume.get());
    syncSpacingControls();
    updateVolumeInfo();
    syncPlaneControls(m_volume->geometry().centerUm(), 0.0, 0.0);
    setMeasurements({});
    updateInterpolation();
    m_sliceView->fitToVolume();
    onZoomChanged(1.0);
    statusBar()->showMessage(
        QStringLiteral("已载入 %1 · %2 × %3 × %4")
            .arg(sourceText)
            .arg(m_volume->geometry().nx)
            .arg(m_volume->geometry().ny)
            .arg(m_volume->geometry().nz),
        6000);
}

void MainWindow::updateVolumeInfo() {
    if (!m_volume || m_volume->isEmpty()) {
        m_sourceLabel->setText(QStringLiteral("未载入数据"));
        m_volumeInfoLabel->clear();
        return;
    }
    const auto &geometry = m_volume->geometry();
    const micro::Vec3 extent = geometry.extentUm();
    m_sourceLabel->setText(m_sourceText);
    m_volumeInfoLabel->setText(
        QStringLiteral("%1 × %2 × %3 体素\n物理范围 %4 × %5 × %6 µm")
            .arg(geometry.nx)
            .arg(geometry.ny)
            .arg(geometry.nz)
            .arg(QString::number(extent.x, 'f', 1),
                 QString::number(extent.y, 'f', 1),
                 QString::number(extent.z, 'f', 1)));
    m_calibrationLabel->setText(
        m_calibrationHint.isEmpty() ? QStringLiteral("当前数据无内置真值")
                                    : m_calibrationHint);
}

void MainWindow::syncSpacingControls() {
    if (!m_volume || m_volume->isEmpty()) {
        return;
    }
    m_syncingControls = true;
    const micro::Vec3 spacing = m_volume->geometry().spacingUm;
    m_spacingSpins[0]->setValue(spacing.x);
    m_spacingSpins[1]->setValue(spacing.y);
    m_spacingSpins[2]->setValue(spacing.z);
    m_syncingControls = false;
}

void MainWindow::syncPlaneControls(const micro::Vec3 &centerUm,
                                   double tiltXDeg, double tiltYDeg) {
    m_syncingControls = true;
    m_centerSpins[0]->setValue(centerUm.x);
    m_centerSpins[1]->setValue(centerUm.y);
    m_centerSpins[2]->setValue(centerUm.z);
    m_tiltSpins[0]->setValue(tiltXDeg);
    m_tiltSpins[1]->setValue(tiltYDeg);
    m_syncingControls = false;
}

void MainWindow::loadCalibrationPhantom() {
    micro::Phantom phantom = micro::makeCalibrationPhantom();
    const auto &spec = phantom.spec;
    auto volume = std::make_unique<micro::Volume>(std::move(phantom.volume));
    const QString hint =
        QStringLiteral("球 Ø%1 µm · 双标记 %2 µm / %3°\n薄杆 Ø%4 µm · 阈值 %5")
            .arg(QString::number(spec.sphereDiameterUm, 'f', 0),
                 QString::number(spec.fiducialLengthUm, 'f', 1),
                 QString::number(spec.fiducialTiltDeg, 'f', 1),
                 QString::number(spec.thinRodDiameterUm, 'f', 0),
                 QString::number(spec.threshold, 'f', 2));
    installVolume(std::move(volume), QStringLiteral("内置校准体模"), hint);
    m_tabs->setCurrentIndex(0);
    m_measurementMode->setChecked(true);
}

void MainWindow::openImageStack() {
    const QStringList files = QFileDialog::getOpenFileNames(
        this, QStringLiteral("选择按 Z 排序的切片图像"), QString(),
        QStringLiteral("图像 (*.png *.tif *.tiff *.jpg *.jpeg *.bmp);;所有文件 (*)"));
    if (files.isEmpty()) {
        return;
    }

    QDialog dialog(this);
    dialog.setWindowTitle(QStringLiteral("设置物理体素间距"));
    auto *layout = new QVBoxLayout(&dialog);
    auto *description = new QLabel(
        QStringLiteral("切片将按文件名自然排序。\n"
                       "X/Y 为像素中心间距，Z 为相邻切片的物理层厚。"),
        &dialog);
    description->setWordWrap(true);
    layout->addWidget(description);
    auto *form = new QFormLayout();
    const QString labels[3] = {QStringLiteral("X 像素间距"), QStringLiteral("Y 像素间距"),
                               QStringLiteral("Z 层厚")};
    QDoubleSpinBox *spins[3] = {nullptr, nullptr, nullptr};
    const micro::Vec3 currentSpacing =
        m_volume ? m_volume->geometry().spacingUm : micro::Vec3{5.0, 5.0, 10.0};
    const double currentValues[3] = {currentSpacing.x, currentSpacing.y,
                                     currentSpacing.z};
    for (int index = 0; index < 3; ++index) {
        spins[index] =
            makeSpinBox(&dialog, QStringLiteral(" µm"), 0.001, 100000.0, 0.1, 4);
        spins[index]->setValue(currentValues[index]);
        form->addRow(labels[index], spins[index]);
    }
    auto *defaults = new QHBoxLayout();
    auto *commonButton = new QPushButton(QStringLiteral("共聚焦 5/5/5 µm"), &dialog);
    auto *anisotropicButton =
        new QPushButton(QStringLiteral("各向异性 5/7.5/12 µm"), &dialog);
    defaults->addWidget(commonButton);
    defaults->addWidget(anisotropicButton);
    form->addRow(QString(), defaults);
    connect(commonButton, &QPushButton::clicked, &dialog, [spins] {
        spins[0]->setValue(5.0);
        spins[1]->setValue(5.0);
        spins[2]->setValue(5.0);
    });
    connect(anisotropicButton, &QPushButton::clicked, &dialog, [spins] {
        spins[0]->setValue(5.0);
        spins[1]->setValue(7.5);
        spins[2]->setValue(12.0);
    });
    layout->addLayout(form);
    auto *buttons =
        new QDialogButtonBox(QDialogButtonBox::Ok | QDialogButtonBox::Cancel,
                             &dialog);
    connect(buttons, &QDialogButtonBox::accepted, &dialog, &QDialog::accept);
    connect(buttons, &QDialogButtonBox::rejected, &dialog, &QDialog::reject);
    layout->addWidget(buttons);
    if (dialog.exec() != QDialog::Accepted) {
        return;
    }

    const micro::Vec3 spacing{spins[0]->value(), spins[1]->value(),
                              spins[2]->value()};
    LoadedStack loaded;
    QString error;
    QApplication::setOverrideCursor(Qt::WaitCursor);
    const bool success = loadImageStack(files, spacing, &loaded, &error);
    QApplication::restoreOverrideCursor();
    if (!success) {
        QMessageBox::critical(this, QStringLiteral("载入失败"), error);
        return;
    }
    const QString source =
        QStringLiteral("图像堆栈 · %1 张").arg(loaded.files.size());
    installVolume(std::make_unique<micro::Volume>(std::move(loaded.volume)),
                  source, QStringLiteral("当前数据无内置校准真值"));
    m_tabs->setCurrentIndex(0);
}

void MainWindow::setFrontView() {
    if (!m_volume || m_volume->isEmpty()) {
        return;
    }
    m_syncingControls = true;
    m_tiltSpins[0]->setValue(0.0);
    m_tiltSpins[1]->setValue(0.0);
    m_syncingControls = false;
    m_sliceView->setPlane(m_sliceView->planeCenter().x,
                          m_sliceView->planeCenter().y,
                          m_sliceView->planeCenter().z, 0.0, 0.0);
    m_overviewView->setPlane(m_sliceView->planeCenter(), 0.0, 0.0);
    m_sliceView->fitToVolume();
    syncPlaneControls(m_sliceView->planeCenter(), 0.0, 0.0);
    m_overviewView->setPlane(m_sliceView->planeCenter(), 0.0, 0.0);
    m_tabs->setCurrentIndex(0);
    statusBar()->showMessage(QStringLiteral("已切换到正视 XY（物理比例）"), 3000);
}

void MainWindow::fitCurrentView() {
    if (m_tabs->currentIndex() == 1) {
        m_overviewView->resetOrientation();
        statusBar()->showMessage(QStringLiteral("3D 相机已复位"), 2500);
        return;
    }
    m_sliceView->fitToVolume();
    syncPlaneControls(m_sliceView->planeCenter(), m_sliceView->tiltXDeg(),
                      m_sliceView->tiltYDeg());
    m_overviewView->setPlane(m_sliceView->planeCenter(),
                             m_sliceView->tiltXDeg(), m_sliceView->tiltYDeg());
}

void MainWindow::showOverview() {
    m_tabs->setCurrentIndex(1);
    m_overviewView->setFocus();
}

void MainWindow::applySpacingControls() {
    if (m_syncingControls || !m_volume || m_volume->isEmpty()) {
        return;
    }
    const micro::Vec3 oldSpacing = m_volume->geometry().spacingUm;
    const micro::Vec3 newSpacing{m_spacingSpins[0]->value(),
                                 m_spacingSpins[1]->value(),
                                 m_spacingSpins[2]->value()};
    if (newSpacing.x <= 0.0 || newSpacing.y <= 0.0 || newSpacing.z <= 0.0) {
        return;
    }
    if (std::abs(newSpacing.x - oldSpacing.x) < 1e-12 &&
        std::abs(newSpacing.y - oldSpacing.y) < 1e-12 &&
        std::abs(newSpacing.z - oldSpacing.z) < 1e-12) {
        return;
    }
    const auto remap = [&](const micro::Vec3 &point) {
        return micro::Vec3{point.x / oldSpacing.x * newSpacing.x,
                           point.y / oldSpacing.y * newSpacing.y,
                           point.z / oldSpacing.z * newSpacing.z};
    };
    const micro::Vec3 oldCenter = m_sliceView->planeCenter();
    const double tiltX = m_sliceView->tiltXDeg();
    const double tiltY = m_sliceView->tiltYDeg();
    for (Measurement &measurement : m_measurements) {
        measurement.aUm = remap(measurement.aUm);
        measurement.bUm = remap(measurement.bUm);
    }
    m_volume->setSpacingUm(newSpacing);
    const micro::Vec3 center = remap(oldCenter);
    updateVolumeInfo();
    m_sliceView->setPlane(center.x, center.y, center.z, tiltX, tiltY);
    m_sliceView->refreshGeometry();
    m_sliceView->setMeasurements(m_measurements);
    m_overviewView->setPlane(center, tiltX, tiltY);
    m_overviewView->refreshGeometry();
    m_overviewView->setMeasurements(m_measurements);
    syncPlaneControls(center, tiltX, tiltY);
    updateMeasurementsTable();
    statusBar()->showMessage(
        QStringLiteral("物理间距更新为 X %1 / Y %2 / Z %3 µm")
            .arg(QString::number(newSpacing.x, 'f', 3),
                 QString::number(newSpacing.y, 'f', 3),
                 QString::number(newSpacing.z, 'f', 3)),
        4000);
}

void MainWindow::applyPlaneControls() {
    if (m_syncingControls || !m_volume || m_volume->isEmpty()) {
        return;
    }
    const micro::Vec3 center{m_centerSpins[0]->value(), m_centerSpins[1]->value(),
                             m_centerSpins[2]->value()};
    const double tiltX = m_tiltSpins[0]->value();
    const double tiltY = m_tiltSpins[1]->value();
    m_sliceView->setPlane(center.x, center.y, center.z, tiltX, tiltY);
    m_overviewView->setPlane(center, tiltX, tiltY);
}

void MainWindow::updateInterpolation() {
    if (!m_sliceView) {
        return;
    }
    const auto mode = static_cast<micro::Interpolation>(
        m_interpolationCombo->currentData().toInt());
    m_sliceView->setInterpolation(mode);
    statusBar()->showMessage(
        QStringLiteral("插值：%1")
            .arg(QString::fromUtf8(micro::interpolationDisplayName(mode))),
        2500);
}

void MainWindow::onPlaneCenterChanged(const micro::Vec3 &centerUm) {
    if (m_syncingControls) {
        return;
    }
    syncPlaneControls(centerUm, m_sliceView->tiltXDeg(),
                      m_sliceView->tiltYDeg());
    m_overviewView->setPlane(centerUm, m_sliceView->tiltXDeg(),
                             m_sliceView->tiltYDeg());
}

void MainWindow::setMeasurements(const QVector<Measurement> &measurements) {
    m_measurements = measurements;
    if (m_sliceView) {
        m_sliceView->setMeasurements(m_measurements);
    }
    if (m_overviewView) {
        m_overviewView->setMeasurements(m_measurements);
    }
    updateMeasurementsTable();
}

void MainWindow::addMeasurement(const micro::Vec3 &aUm, const micro::Vec3 &bUm) {
    Measurement measurement{aUm, bUm};
    m_measurements.append(measurement);
    setMeasurements(m_measurements);
    statusBar()->showMessage(
        QStringLiteral("已添加物理距离 %1 µm")
            .arg(QString::number(measurement.lengthUm(), 'f', 2)),
        3500);
}

void MainWindow::deleteSelectedMeasurements() {
    QVector<int> rows;
    const auto selected = m_measurementTable->selectionModel()->selectedRows();
    for (const QModelIndex &index : selected) {
        rows.append(index.row());
    }
    std::sort(rows.begin(), rows.end(), std::greater<int>());
    rows.erase(std::unique(rows.begin(), rows.end()), rows.end());
    for (int row : rows) {
        if (row >= 0 && row < m_measurements.size()) {
            m_measurements.removeAt(row);
        }
    }
    setMeasurements(m_measurements);
}

void MainWindow::clearMeasurements() {
    if (m_measurements.isEmpty()) {
        return;
    }
    setMeasurements({});
    statusBar()->showMessage(QStringLiteral("测量记录已清空"), 2500);
}

void MainWindow::updateMeasurementsTable() {
    m_measurementTable->setRowCount(m_measurements.size());
    for (int row = 0; row < m_measurements.size(); ++row) {
        const Measurement &measurement = m_measurements[row];
        const micro::Vec3 delta = measurement.bUm - measurement.aUm;
        const QStringList values = {
            QString::number(measurement.lengthUm(), 'f', 2),
            QString::number(delta.x, 'f', 2),
            QString::number(delta.y, 'f', 2),
            QString::number(delta.z, 'f', 2),
            QStringLiteral("%1°").arg(QString::number(
                std::abs(measurement.elevationDeg()), 'f', 2))};
        for (int column = 0; column < values.size(); ++column) {
            auto *item = m_measurementTable->item(row, column);
            if (!item) {
                item = new QTableWidgetItem();
                item->setTextAlignment(Qt::AlignRight | Qt::AlignVCenter);
                m_measurementTable->setItem(row, column, item);
            }
            item->setText(values[column]);
        }
    }
    m_clearAction->setEnabled(!m_measurements.isEmpty());
}

void MainWindow::onZoomChanged(double zoom) {
    if (m_zoomLabel) {
        m_zoomLabel->setText(
            QStringLiteral("视图 %1%").arg(QString::number(zoom * 100.0, 'f', 0)));
    }
}

void MainWindow::onViewInfoChanged(const QString &text) {
    statusBar()->showMessage(text);
}

void MainWindow::onOverviewInfoChanged(const QString &text) {
    statusBar()->showMessage(text);
}

void MainWindow::showCalibrationReport() {
    QApplication::setOverrideCursor(Qt::WaitCursor);
    const micro::Phantom phantom = micro::makeCalibrationPhantom();
    const micro::ValidationReport report = micro::runValidation(phantom);
    const QString markdown = QString::fromStdString(report.markdown());
    QApplication::restoreOverrideCursor();

    QDialog dialog(this);
    dialog.setWindowTitle(QStringLiteral("校准与插值误差报告"));
    dialog.resize(1020, 700);
    auto *layout = new QVBoxLayout(&dialog);
    auto *header = new QLabel(
        QStringLiteral("<b>已知真值验证</b> · 各向异性 5 / 7.5 / 12 µm · "
                       "同样的物理坐标采样管线"),
        &dialog);
    layout->addWidget(header);
    auto *browser = new QTextBrowser(&dialog);
    browser->setMarkdown(markdown);
    browser->setOpenExternalLinks(false);
    layout->addWidget(browser, 1);
    auto *buttons = new QDialogButtonBox(QDialogButtonBox::Close, &dialog);
    auto *save = buttons->addButton(QStringLiteral("保存 Markdown…"),
                                    QDialogButtonBox::ActionRole);
    connect(buttons, &QDialogButtonBox::rejected, &dialog, &QDialog::reject);
    connect(save, &QPushButton::clicked, &dialog, [this, markdown] {
        const QString path = QFileDialog::getSaveFileName(
            this, QStringLiteral("保存校准报告"),
            QStringLiteral("calibration_report.md"),
            QStringLiteral("Markdown (*.md);;所有文件 (*)"));
        if (path.isEmpty()) {
            return;
        }
        QFile file(path);
        if (file.open(QIODevice::WriteOnly)) {
            file.write(markdown.toUtf8());
        }
    });
    layout->addWidget(buttons);
    dialog.exec();
}

QString MainWindow::measurementMetadata() const {
    QString out;
    const auto &geometry = m_volume->geometry();
    out += QStringLiteral("MicroSlice 3D export\n");
    out += QStringLiteral("source=%1\n").arg(m_sourceText);
    out += QStringLiteral("dimensions=%1,%2,%3\n")
               .arg(geometry.nx)
               .arg(geometry.ny)
               .arg(geometry.nz);
    out += QStringLiteral("spacing_um=%1,%2,%3\n")
               .arg(QString::number(geometry.spacingUm.x, 'f', 6),
                    QString::number(geometry.spacingUm.y, 'f', 6),
                    QString::number(geometry.spacingUm.z, 'f', 6));
    out += QStringLiteral("interpolation=%1\n")
               .arg(QString::fromUtf8(micro::interpolationDisplayName(
                   static_cast<micro::Interpolation>(
                       m_interpolationCombo->currentData().toInt()))));
    out += QStringLiteral("plane_center_um=%1,%2,%3\n")
               .arg(QString::number(m_sliceView->planeCenter().x, 'f', 4),
                    QString::number(m_sliceView->planeCenter().y, 'f', 4),
                    QString::number(m_sliceView->planeCenter().z, 'f', 4));
    out += QStringLiteral("plane_tilt_deg=%1,%2\n")
               .arg(QString::number(m_sliceView->tiltXDeg(), 'f', 4),
                    QString::number(m_sliceView->tiltYDeg(), 'f', 4));
    out += QStringLiteral("overview_yaw_pitch_deg=%1,%2\n")
               .arg(QString::number(m_overviewView->yawDeg(), 'f', 4),
                    QString::number(m_overviewView->pitchDeg(), 'f', 4));
    for (int index = 0; index < m_measurements.size(); ++index) {
        const Measurement &measurement = m_measurements[index];
        out += QStringLiteral(
                   "measurement_%1 a_um=%2,%3,%4 b_um=%5,%6,%7 "
                   "length_um=%8 tilt_deg=%9\n")
                   .arg(index + 1)
                   .arg(QString::number(measurement.aUm.x, 'f', 4),
                        QString::number(measurement.aUm.y, 'f', 4),
                        QString::number(measurement.aUm.z, 'f', 4),
                        QString::number(measurement.bUm.x, 'f', 4),
                        QString::number(measurement.bUm.y, 'f', 4),
                        QString::number(measurement.bUm.z, 'f', 4),
                        QString::number(measurement.lengthUm(), 'f', 4),
                        QString::number(measurement.elevationDeg(), 'f', 4));
    }
    return out;
}

void MainWindow::exportCurrentView() {
    if (!m_volume || m_volume->isEmpty()) {
        return;
    }
    const QString path = QFileDialog::getSaveFileName(
        this, QStringLiteral("导出当前视图"),
        QStringLiteral("microslice_view.png"),
        QStringLiteral("PNG 图像 (*.png);;JPEG 图像 (*.jpg)"));
    if (path.isEmpty()) {
        return;
    }
    QWidget *view = m_tabs->currentWidget();
    const QPixmap image = view->grab();
    if (!image.save(path)) {
        QMessageBox::warning(this, QStringLiteral("导出失败"),
                             QStringLiteral("无法写入图像：%1").arg(path));
        return;
    }
    const QFileInfo info(path);
    const QString metadataPath =
        info.path() + QStringLiteral("/") + info.completeBaseName() +
        QStringLiteral(".txt");
    QFile metadata(metadataPath);
    if (metadata.open(QIODevice::WriteOnly)) {
        metadata.write(measurementMetadata().toUtf8());
    }
    statusBar()->showMessage(
        QStringLiteral("已导出图像与物理元数据：%1").arg(path), 5000);
}

} // namespace microqt

