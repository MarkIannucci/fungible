# VHS tape — captures screenshots of each fungible screen in demo mode
# Run with: vhs scripts/demo.tape

Output docs/screenshots/demo.gif

Set Shell "bash"
Set FontSize 13
Set Width 1200
Set Height 780
Set Theme "Catppuccin Mocha"
Set Padding 16
Set FontFamily "JetBrains Mono"
Set TypingSpeed 50ms

# Start the app in demo mode
Type "npm run demo"
Enter
Sleep 12s

Screenshot docs/screenshots/dashboard.png

Type "2"
Sleep 2s
Screenshot docs/screenshots/transactions.png

Type "3"
Sleep 2s
Screenshot docs/screenshots/trends.png

Type "4"
Sleep 2s
Screenshot docs/screenshots/net-worth.png

Type "5"
Sleep 2s
Screenshot docs/screenshots/tags.png

Type "6"
Sleep 2s
Screenshot docs/screenshots/financial-health.png

Type "7"
Sleep 2s
Screenshot docs/screenshots/rules.png

Type "8"
Sleep 2s
Screenshot docs/screenshots/accounts.png

Sleep 1s
