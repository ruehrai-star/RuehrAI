# Runbook: Tägliches Postgres-Backup (Eule)

Verantwortlich: System-Admin  
Confluence: https://ruehrai.atlassian.net/wiki/spaces/~71202025d18744898f43209641d6b31d2aa674/pages/25559041 (Entscheidung)

## Parameter
- Host: Eule (STAGE)
- Zeit: täglich 23:30 Europe/Berlin
- Ziel: `/Users/ruehrai/Documents/Backup`
- Format: `pg_dump -Fc`
- Dateien: `brain_YYYY-MM-DD.dump`, `data-scout_YYYY-MM-DD.dump`
- Postgres.app PATH: `/Applications/Postgres.app/Contents/Versions/latest/bin`
- Retention: 7 Tage (mtime)
- Bei Fehler: CTO/RuehrAI sofort informieren

## Manuell
```bash
export PATH="/Applications/Postgres.app/Contents/Versions/latest/bin:$PATH"
mkdir -p /Users/ruehrai/Documents/Backup
DATE=$(date +%Y-%m-%d)
pg_dump -U postgres -Fc -f "/Users/ruehrai/Documents/Backup/brain_${DATE}.dump" Brain
pg_dump -U postgres -Fc -f "/Users/ruehrai/Documents/Backup/data-scout_${DATE}.dump" "Data-Scout"
find /Users/ruehrai/Documents/Backup -name 'brain_*.dump' -mtime +7 -delete
find /Users/ruehrai/Documents/Backup -name 'data-scout_*.dump' -mtime +7 -delete
```

## Probelauf 2026-09-29
- brain_2026-09-29.dump — 116 MB OK
- data-scout_2026-09-29.dump — 82 MB OK

## Nicht im Scope
Monitoring, PROD/Fuchs, Deploys.
