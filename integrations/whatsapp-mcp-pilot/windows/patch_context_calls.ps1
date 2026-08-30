param([Parameter(Mandatory=$true)][string]$Bridge)
$main = Join-Path $Bridge 'main.go'
if (!(Test-Path $main)) { throw "main.go tidak ditemukan: $main" }
$s = [IO.File]::ReadAllText($main)

# Ensure Unit Elite verify handler targets context-aware whatsmeow API.
$s = $s.Replace('client.IsOnWhatsApp(phones)', 'client.IsOnWhatsApp(context.Background(), phones)')

# Known upstream API transitions after updating whatsmeow.
$s = $s.Replace('client.Download(downloader)', 'client.Download(context.Background(), downloader)')
$s = $s.Replace('sqlstore.New("sqlite3", "file:store/whatsapp.db?_foreign_keys=on", dbLog)', 'sqlstore.New(context.Background(), "sqlite3", "file:store/whatsapp.db?_foreign_keys=on", dbLog)')
$s = $s.Replace('container.GetFirstDevice()', 'container.GetFirstDevice(context.Background())')
$s = $s.Replace('client.GetGroupInfo(jid)', 'client.GetGroupInfo(context.Background(), jid)')
$s = $s.Replace('client.Store.Contacts.GetContact(jid)', 'client.Store.Contacts.GetContact(context.Background(), jid)')

[IO.File]::WriteAllText($main, $s, [Text.UTF8Encoding]::new($false))
Write-Host '[OK] Known context-aware call sites patched.'
