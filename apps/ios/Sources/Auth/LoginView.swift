import SwiftUI

struct LoginView: View {
    @EnvironmentObject private var session: SessionStore
    @State private var email = ""
    @State private var password = ""

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("RuehrAI")
                        .font(.largeTitle.bold())
                    Text("Location advisory for Germany")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                }

                VStack(spacing: 12) {
                    TextField("Email", text: $email)
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .padding(12)
                        .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                    SecureField("Password", text: $password)
                        .textContentType(.password)
                        .padding(12)
                        .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                }

                if let lastError = session.lastError {
                    Text(lastError)
                        .font(.subheadline)
                        .foregroundStyle(.red)
                        .accessibilityLabel(lastError)
                }

                Button(action: signIn) {
                    Text("Sign in")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(AppTheme.accent)

                Text("This sign-in does not contact a server. It checks the shape of the email and password, then keeps a stub token in memory. A later slice will call the Backend JWT or session endpoint.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                Spacer()
            }
            .padding(24)
            .toolbar(.hidden, for: .navigationBar)
        }
    }

    private func signIn() {
        session.signIn(email: email, password: password)
        if session.isSignedIn {
            password = ""
        }
    }
}

#Preview {
    LoginView()
        .environmentObject(SessionStore())
}
