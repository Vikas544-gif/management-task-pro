import { useState } from "react";
import { useLogin } from "@workspace/api-client-react";

interface LoginProps {
  onLogin: (user: any) => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const loginMutation = useLogin();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    loginMutation.mutate(
      { data: { username, password } },
      {
        onSuccess: (user) => onLogin(user),
        onError: () => setError("Invalid username or password"),
      }
    );
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" }}>
      <div className="bg-card rounded-2xl shadow-2xl p-8 w-full max-w-sm">
        <div className="flex items-center justify-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center text-white font-bold text-lg">
            MTP
          </div>
        </div>
        <h1 className="text-2xl font-extrabold text-center text-foreground mb-1">Management Task Pro</h1>
        <p className="text-center text-sm text-muted-foreground mb-7">Task Management System</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5" htmlFor="input-username">Username</label>
            <input
              id="input-username"
              data-testid="input-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary transition"
              placeholder="Enter your username"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5" htmlFor="input-password">Password</label>
            <div className="relative">
              <input
                id="input-password"
                data-testid="input-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 pr-10 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary transition"
                placeholder="Enter your password"
                required
              />
              <button
                type="button"
                data-testid="btn-toggle-password"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground transition"
              >
                {showPassword ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                    <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                    <line x1="2" x2="22" y1="2" y2="22" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>
          {error && <p className="text-red-600 dark:text-red-300 text-xs font-medium">{error}</p>}
          <button
            type="submit"
            data-testid="btn-login"
            disabled={loginMutation.isPending}
            className="w-full py-2.5 bg-primary text-white font-semibold rounded-lg text-sm hover:bg-primary/90 disabled:opacity-60 transition"
          >
            {loginMutation.isPending ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
