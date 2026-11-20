#include "io/VolumeIO.h"

#include <QImage>
#include <QImageReader>

#include <algorithm>

namespace microqt {
namespace {

QString naturalSortKey(const QString &text) {
    QString key;
    int index = 0;
    while (index < text.size()) {
        if (text[index].isDigit()) {
            const int start = index;
            while (index < text.size() && text[index].isDigit()) {
                ++index;
            }
            QString digits = text.mid(start, index - start);
            while (digits.size() > 1 && digits.front() == QLatin1Char('0')) {
                digits.remove(0, 1);
            }
            key += QChar(1);
            key += QString::number(digits.size()).rightJustified(4, QLatin1Char('0'));
            key += digits;
        } else {
            key += text[index].toLower();
            ++index;
        }
    }
    return key;
}

} // namespace

QStringList naturalSortFiles(const QStringList &files) {
    QStringList sorted = files;
    std::sort(sorted.begin(), sorted.end(),
              [](const QString &a, const QString &b) {
                  return naturalSortKey(a) < naturalSortKey(b);
              });
    return sorted;
}

bool loadImageStack(const QStringList &files, const micro::Vec3 &spacingUm,
                    LoadedStack *loaded, QString *error) {
    if (!loaded || files.isEmpty()) {
        if (error) {
            *error = QStringLiteral("未选择图像。");
        }
        return false;
    }

    const QStringList sorted = naturalSortFiles(files);
    QImage first;
    {
        QImageReader reader(sorted.first());
        reader.setAutoTransform(true);
        first = reader.read();
        if (first.isNull()) {
            if (error) {
                *error = QStringLiteral("无法读取 %1：%2")
                             .arg(sorted.first(), reader.errorString());
            }
            return false;
        }
    }

    first = first.convertToFormat(QImage::Format_Grayscale8);
    const int nx = first.width();
    const int ny = first.height();
    const int nz = sorted.size();
    micro::Volume volume({nx, ny, nz, spacingUm, {0.0, 0.0, 0.0}});

    for (int z = 0; z < nz; ++z) {
        QImage image = z == 0 ? first : QImage();
        if (z > 0) {
            QImageReader reader(sorted[z]);
            reader.setAutoTransform(true);
            image = reader.read();
            if (image.isNull()) {
                if (error) {
                    *error = QStringLiteral("无法读取 %1：%2")
                                 .arg(sorted[z], reader.errorString());
                }
                return false;
            }
            image = image.convertToFormat(QImage::Format_Grayscale8);
        }
        if (image.width() != nx || image.height() != ny) {
            if (error) {
                *error = QStringLiteral("切片尺寸不一致：%1 为 %2 x %3，期望 %4 x %5")
                             .arg(sorted[z])
                             .arg(image.width())
                             .arg(image.height())
                             .arg(nx)
                             .arg(ny);
            }
            return false;
        }
        for (int y = 0; y < ny; ++y) {
            const uchar *line = image.constScanLine(y);
            for (int x = 0; x < nx; ++x) {
                volume.at(x, y, z) = line[x] / 255.0f;
            }
        }
    }

    volume.refreshRange();
    loaded->volume = std::move(volume);
    loaded->files = sorted;
    return true;
}

} // namespace microqt

