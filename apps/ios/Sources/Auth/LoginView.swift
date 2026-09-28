import SwiftUI

struct LoginView: View {
    @EnvironmentObject private var session: SessionStore
    @State private var email = ""
    @State private var password = ""
    @State private var createAccount = false

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

                Picker("Account", selection: $createAccount) {
                    Text("Sign in").tag(false)
                    Text("Create account").tag(true)
                }
                .pickerStyle(.segmented)

                VStack(spacing: 12) {
                    TextField("Email", text: $email)
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .padding(12)
                        .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                    SecureField("Password", text: $password)
                        .textContentType(createAccount ? .newPassword : .password)
                        .padding(12)
                        .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                }

                if let lastError = session.lastError {
                    Text(lastError)
                        .font(.subheadline)
                        .foregroundStyle(.red)
                }

                Button(action: submit) {
                    Text(createAccount ? "Create account" : "Sign in")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(AppTheme.accent)
                .disabled(session.isWorking)

                Text(footnote)
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                Spacer()
            }
            .padding(24)
            .toolbar(.hidden, for: .navigationBar)
        }
    }

    private var footnote: String {
        if session.usesFixture {
            return "No Backend base URL is set, so this screen uses the offline fixture for POST /auth/login and POST /auth/register. Any email and a password of 8 to 72 characters are accepted. The token stays in memory and is not a JWT."
        }
        return "POST /auth/login returns a Bearer JWT, kept in memory. Local Backend seed user from the contract: dev@ruehrai.local. Password length is 8 to 72 characters."
    }

    private func submit() {
        let email = email
        let password = password
        Task {
            if createAccount {
                await session.register(email: email, password: password)
            } else {
                await session.signIn(email: email, password: password)
            }
            if session.isSignedIn {
                self.password = ""
            }
        }
    }
}

#Preview {
    LoginView()
        .environmentObject(SessionStore(connection: .fixture))
}
