#pragma once

#include "core/Volume.h"

#include <QString>
#include <QStringList>

namespace microqt {

struct LoadedStack {
    micro::Volume volume;
    QStringList files;
};

QStringList naturalSortFiles(const QStringList &files);
bool loadImageStack(const QStringList &files, const micro::Vec3 &spacingUm,
                    LoadedStack *loaded, QString *error);

} // namespace microqt

