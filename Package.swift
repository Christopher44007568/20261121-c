// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "StarPreviewer",
    platforms: [.macOS(.v13)],
    targets: [
        .target(
            name: "StarCore",
            path: "Sources/StarCore"
        ),
        .executableTarget(
            name: "StarPreviewer",
            dependencies: ["StarCore"],
            path: "Sources/StarPreviewer"
        ),
        .testTarget(
            name: "PhotometryTests",
            dependencies: ["StarCore"],
            path: "Tests/PhotometryTests"
        ),
    ]
)
