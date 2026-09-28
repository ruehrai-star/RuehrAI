import SwiftUI

struct RootView: View {
    @EnvironmentObject private var session: SessionStore

    var body: some View {
        Group {
            if session.isSignedIn {
                MapScreen()
            } else {
                LoginView()
            }
        }
        .tint(AppTheme.accent)
    }
}
