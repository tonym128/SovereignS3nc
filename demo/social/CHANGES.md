I've updated the Social Demo to include robust profile management and session persistence.

**Key Changes:**

1.  **Session Persistence**:
    *   Successful logins are now saved to `localStorage`.
    *   The app remembers your credentials (encrypted locally by the browser's storage mechanisms) and profile details.

2.  **Auto-Login**:
    *   On page load, the app checks for the last active session and automatically reconnects you, skipping the login screen.

3.  **Reconnect UI**:
    *   If you log out, you are presented with a list of "Saved Sessions".
    *   You can quickly reconnect to any previous account with a single click.
    *   You can also remove old sessions from the list.

4.  **Logout**:
    *   Added a "Logout" button to the top-right profile header.
    *   Logging out clears the auto-login flag but keeps your session details in the "Saved List" for easy access later.

5.  **New Connect Flow**:
    *   You can always choose to "Connect New" to sign in with different credentials, which will then be added to your saved sessions.

**To test the changes:**
1.  Open the social demo in your browser (via `http-server` or similar).
2.  Login as usual.
3.  Refresh the page -> You should be auto-logged in.
4.  Click "Logout".
5.  You should see your profile in the "Reconnect" list.
6.  Click your profile to log back in instantly.