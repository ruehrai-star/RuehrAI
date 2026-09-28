import RuehrAPI
import SwiftUI

struct RootView: View {
    @EnvironmentObject private var session: SessionStore

    var body: some View {
        Group {
            if session.isSignedIn {
                MapScreen(client: session.client)
            } else {
                LoginView()
            }
        }
        .tint(AppTheme.accent)
    }
}
