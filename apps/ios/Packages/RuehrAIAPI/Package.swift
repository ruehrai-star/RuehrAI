// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "RuehrAIAPI",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "RuehrAIAPI", targets: ["RuehrAIAPI"]),
    ],
    targets: [
        .target(name: "RuehrAIAPI"),
        .testTarget(
            name: "RuehrAIAPITests",
            dependencies: ["RuehrAIAPI"]
        ),
    ]
)
