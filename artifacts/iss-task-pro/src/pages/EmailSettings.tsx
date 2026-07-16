import { useState } from "react";
import { useGetEmailSettings, useSendTestEmail, useSendDigestNow, useSendDashboardNow } from "@workspace/api-client-react";

export default function EmailSettings() {
  const { data: settings, isLoading } = useGetEmailSettings();
  const sendTest = useSendTestEmail();
  const sendDigest = useSendDigestNow();
  const sendDashboard = useSendDashboardNow();

  const [testEmail, setTestEmail] = useState("");
  const [testResult, setTestResult] = useState("");
  const [digestResult, setDigestResult] = useState("");
  const [digestOk, setDigestOk] = useState(false);
  const [dashboardResult, setDashboardResult] = useState("");
  const [dashboardOk, setDashboardOk] = useState(false);

  const handleTest = () => {
    setTestResult("");
    sendTest.mutate(
      { data: { toEmail: testEmail } },
      {
        onSuccess: (res) => setTestResult(res.message),
        onError: () => setTestResult("Failed to send test email"),
      }
    );
  };

  const handleSendDigest = () => {
    setDigestResult("");
    sendDigest.mutate(undefined, {
      onSuccess: (res) => { setDigestResult(res.message); setDigestOk(res.sent > 0); },
      onError: () => { setDigestResult("There was a problem sending the reminder"); setDigestOk(false); },
    });
  };

  const handleSendDashboard = () => {
    setDashboardResult("");
    sendDashboard.mutate(undefined, {
      onSuccess: (res) => { setDashboardResult(res.message); setDashboardOk(res.sent > 0); },
      onError: () => { setDashboardResult("There was a problem sending the dashboard summary"); setDashboardOk(false); },
    });
  };

  return (
    <div className="p-6 max-w-xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground">Email Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Auto email notifications for tasks and reminders</p>
      </div>

      {/* Info box */}
      <div className="mb-5 p-4 bg-primary/10 border border-primary/30 rounded-xl">
        <div className="font-semibold text-primary text-sm mb-2">How Auto Email Works</div>
        <ul className="text-xs text-primary space-y-1.5 list-disc list-inside">
          <li>Emails are sent through Resend — no SMTP password needed</li>
          <li>Every time a task is assigned, the assignee gets an email automatically</li>
          <li>Daily task reminders go out every morning at 9:00 AM</li>
          <li>Weekly reminders go every Monday at 9:00 AM</li>
          <li>Monthly reminders go on the 1st of each month at 9:00 AM</li>
          <li>Each team member must have their email set in the Team page</li>
        </ul>
      </div>

      {/* Status */}
      {!isLoading && (
        <div className={`mb-5 px-4 py-3 rounded-lg border text-sm font-medium flex items-center gap-2 ${settings?.configured ? "bg-green-50 border-green-200 text-green-700 dark:bg-green-950/40 dark:border-green-800 dark:text-green-300" : "bg-background border-border text-muted-foreground"}`}>
          <span className={`w-2 h-2 rounded-full ${settings?.configured ? "bg-green-500" : "bg-muted"}`}></span>
          {settings?.configured ? `Auto email active — sending from ${settings.smtpEmail}` : "Email not configured"}
        </div>
      )}

      {/* Domain verification note */}
      <div className="mb-5 p-4 bg-amber-50 border border-amber-200 dark:bg-amber-950/40 dark:border-amber-800 rounded-xl">
        <div className="font-semibold text-amber-800 dark:text-amber-300 text-sm mb-1">Sending to your whole team</div>
        <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
          Right now emails send from a Resend test address, which can only deliver to the email you signed up to Resend with.
          To send notifications to <b>all team members</b>, verify your company domain in Resend (Domains → Add Domain → add the DNS records).
          Once verified, tell us and we'll switch the sender to your company address.
        </p>
      </div>

      {/* Test email */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-6">
        <div className="text-xs font-semibold text-muted-foreground mb-2">Send Test Email</div>
        <div className="flex gap-2">
          <input
            data-testid="input-test-email"
            type="email"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            className="flex-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Recipient email"
          />
          <button
            data-testid="btn-send-test"
            onClick={handleTest}
            disabled={sendTest.isPending || !testEmail || !settings?.configured}
            className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-60 transition"
          >
            {sendTest.isPending ? "Sending..." : "Test"}
          </button>
        </div>
        {testResult && (
          <p className={`mt-2 text-xs font-medium ${testResult.includes("success") ? "text-green-600 dark:text-green-300" : "text-red-600 dark:text-red-300"}`}>
            {testResult}
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Tip: send the first test to the email you used to sign up for Resend.</p>
      </div>

      {/* Send daily reminder now */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-6 mt-5">
        <div className="text-xs font-semibold text-muted-foreground mb-1">Daily Pending-Task Reminder</div>
        <p className="text-xs text-muted-foreground mb-3">
          This goes out automatically every morning at 9:00 AM. To test it now, click the button below —
          anyone who has a due/pending task today and a configured email will receive a reminder.
        </p>
        <button
          data-testid="btn-send-digest-now"
          onClick={handleSendDigest}
          disabled={sendDigest.isPending || !settings?.configured}
          className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-60 transition"
        >
          {sendDigest.isPending ? "Sending..." : "📧 Send reminder now"}
        </button>
        {digestResult && (
          <p className={`mt-2 text-xs font-medium ${digestOk ? "text-green-600 dark:text-green-300" : "text-amber-600 dark:text-amber-300"}`}>
            {digestResult}
          </p>
        )}
      </div>

      {/* Send daily dashboard summary now */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-6 mt-5">
        <div className="text-xs font-semibold text-muted-foreground mb-1">Daily Dashboard Summary</div>
        <p className="text-xs text-muted-foreground mb-3">
          A live dashboard snapshot (totals, pending, in progress, completed, completion rate, plus
          category and team breakdowns) goes out automatically every morning at 9:00 AM to the
          selected recipients. Click below to send it now.
        </p>
        <button
          data-testid="btn-send-dashboard-now"
          onClick={handleSendDashboard}
          disabled={sendDashboard.isPending || !settings?.configured}
          className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-60 transition"
        >
          {sendDashboard.isPending ? "Sending..." : "📊 Send dashboard now"}
        </button>
        {dashboardResult && (
          <p className={`mt-2 text-xs font-medium ${dashboardOk ? "text-green-600 dark:text-green-300" : "text-amber-600 dark:text-amber-300"}`}>
            {dashboardResult}
          </p>
        )}
      </div>
    </div>
  );
}
