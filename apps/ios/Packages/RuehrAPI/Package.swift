// swift-tools-version: 6.1
import PackageDescription

let package = Package(
    name: "RuehrAPI",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "RuehrAPI", targets: ["RuehrAPI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-openapi-generator", from: "1.13.1"),
        .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.12.1"),
    ],
    targets: [
        .target(
            name: "RuehrAPI",
            dependencies: [
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
            ],
            plugins: [
                .plugin(name: "OpenAPIGenerator", package: "swift-openapi-generator"),
            ]
        ),
        .testTarget(
            name: "RuehrAPITests",
            dependencies: [
                "RuehrAPI",
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
            ]
        ),
    ]
)
