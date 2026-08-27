# bund forhelved

En mobil PWA til servermålt øl-timing, globale ranglister og private klaner. Brugerfladen er på dansk og er bygget mobile-first med Next.js og Supabase.

## Funktioner

- Serverbaseret start- og stoptid, som klienten ikke kan ændre.
- Brugeren godkender selv resultatet, når øllen er tom.
- Hurtigste godkendte tid pr. bruger og kategori.
- Globale ranglister, hvor alle tider tæller, samt private klan-/arrangementstavler via invitationskode.
- Accepterede venner med en separat vennerangliste og vennebaseret peer review uden delte koder.
- Frivillig videodokumentation til peer review.
- Gæstespillere på delte telefoner med godkendelse via engangskode under Mig.
- Profilbilleder, komplet tidshistorik, personlige statistikker og langtidsholdbare login-sessioner.
- Adminstyring af kategorier, brugere, kode-nulstilling og falske tider.
- Installerbar PWA med offline-forklaring og sikre cache-regler.
- Row Level Security på samtlige data og Storage-objekter.

## Stack

- Next.js App Router, React og TypeScript
- Supabase Auth, Postgres, Row Level Security og Storage
- Tailwind CSS 4 plus et projektspecifikt CSS-designsystem
- Vitest og Testing Library

## Docker (Anbefalet)

Forudsætninger: Docker Engine, Docker Compose 2.20 eller nyere (`docker compose` eller `docker-compose`) og Node.js 22 eller nyere.

Start hele appen, inklusive den lokale Supabase-stack, med:

```bash
./scripts/docker.sh up
```

Første start genererer unikke lokale nøgler i `.env.docker`, bygger appen, kører migrationerne og opretter en administrator. Åbn derefter [http://localhost:3000](http://localhost:3000), og log ind med `admin` / `123`. Appen er tilgængelig på maskinens lokale netværksadresse; Supabase-gatewayen er kun bundet til `127.0.0.1`.

Installation som PWA og kameraoptagelse på en fysisk telefon kræver en HTTPS-adresse, som telefonen stoler på. `http://localhost` virker som sikker udviklingskontekst på værtsmaskinen, men `http://192.168.x.x:3000` gør ikke. Brug derfor en HTTPS-reverse-proxy eller en normal HTTPS-deployment, og behold `AUTH_COOKIE_SECURE=true`, når appen bruges uden for lokal udvikling.

Postgres-data og profilbilleder gemmes i Docker volumes og overlever `down`, genstart og rebuild. Standardkoden er kun egnet til lokal udvikling; kør `./scripts/docker.sh secrets`, og ret `BOOTSTRAP_ADMIN_USERNAME` eller `BOOTSTRAP_ADMIN_PASSWORD` i `.env.docker` før den første `up`, hvis andre har adgang til maskinen. På en eksisterende database kan adgangskoden anvendes med `./scripts/docker.sh reset-admin`; ændring af bootstrap-brugernavnet kræver `reset` for også at fjerne den gamle administrator.

Nyttige kommandoer:

- `./scripts/docker.sh test`: gennemfør en opryddende smoke-test af app, Auth, RLS, timer, venner, klaner og Storage
- `./scripts/docker.sh status`: vis service-status og healthchecks
- `./scripts/docker.sh logs app`: følg loggen for appen; udelad servicenavnet for alle logs
- `./scripts/docker.sh psql`: åbn en Postgres-shell
- `./scripts/docker.sh reset-admin`: anvend bootstrap-adgangskoden på den eksisterende administrator
- `./scripts/docker.sh down`: stop containerne uden at slette data eller nøgler
- `./scripts/docker.sh reset`: slet database, profilbilleder og genererede nøgler

## Supabase-projekt (Manuel Opsætning)

Forudsætninger: Node.js 22 eller nyere, npm og et Supabase-projekt.

1. Installer pakkerne med `npm install`.
2. Kør alle filer i `supabase/migrations` i navnerækkefølge i Supabase SQL Editor. Med Supabase CLI kan migrationerne i stedet køres med `supabase db push`.
3. Sørg for, at Email provider er aktiv under Authentication > Providers, men deaktivér offentlige nyregistreringer. Appen opretter kun brugere gennem serverens Admin API og bekræfter den interne identitet direkte.
4. Kopiér værdierne fra `.env.example` til `.env.local`, og udfyld alle fire værdier.
5. Generér `AUTH_PASSWORD_PEPPER` med eksempelvis `openssl rand -base64 32`. Skift ikke værdien senere, da eksisterende adgangskoder ellers ikke længere kan afledes.
6. Start appen med `npm run dev`.

Appen viser en opsætningsside i stedet for at crashe, hvis Supabase-variablerne mangler.

## Første Admin

Docker-opsætningen opretter automatisk administratoren fra `.env.docker`. Ved manuel opsætning skal du først oprette en normal bruger i appen og derefter køre følgende i Supabase SQL Editor:

```sql
update public.profiles
set role = 'admin'
where username = 'dit_brugernavn';
```

Log ud og ind igen. Skjoldet i topbaren åbner administrationen.

## Loginmodellen

Brugeren indtaster kun brugernavn og adgangskode. Serveren normaliserer brugernavnet, laver en intern ikke-leverbar Auth-identitet og afleder en lang provider-adgangskode med `AUTH_PASSWORD_PEPPER`. Det betyder, at Supabase aldrig modtager den korte adgangskode direkte.

En kode som `123` er stadig nem at gætte online. Supabase Auths rate limits bør derfor være aktive, og installationen bør ikke bruges til følsomme oplysninger. Uden en rigtig mail findes ingen mailbaseret gendannelse; en admin kan sætte en midlertidig kode.

Session-cookies får browserens maksimale praktiske levetid på 400 dage og fornyes løbende af `src/proxy.ts`. De forsvinder stadig ved logout, kontosletning, token-tilbagekaldelse eller rydning af browserdata.

Loginforsøg begrænses i databasen til 8 forsøg pr. brugernavn og 40 pr. klient-IP over 15 minutter. Nøglerne gemmes kun som HMAC-hashes.

## Database og Sikkerhed

Migrationen opretter tabeller, indekser, Storage-bucket, RLS-politikker og RPC-funktioner. Timerfunktionerne bruger `clock_timestamp()` i databasen. Direkte brugerwrites til forsøg er blokeret.

Anvendte Docker-migrationer kontrolleres med checksum. Ret ikke en allerede anvendt migrationsfil; tilføj en ny fil, eller brug `reset` til rent lokale data.

Et forsøg går gennem statuserne `running`, `awaiting_confirmation`, `pending_review` og derefter `approved` eller `declined`. En accepteret ven, som hverken ejer eller optog forsøget, kan peer reviewe det uden en delt kode. Alle indsendte tider tæller på den globale rangliste, mens Venner filtrerer tavlen til brugeren og accepterede venner. Ranglisten vælges før start: `clan_id = null` betyder kun Global, mens en klan-id betyder, at tiden også tæller på den valgte klans tavle. En admin kan skifte et stoppet resultat til `invalidated`, hvilket fjerner det fra alle relevante ranglister, men bevarer revisionssporet.

Gæsteadgang giver kun en anden konto lov til at betjene timeren og tilskrive et resultat; den giver ikke adgang til gæstens profil, adgangskode eller administration. Et stoppet resultat kan flyttes til en godkendt gæst, inden det bekræftes. Hvis en klanejer slettes, overtager det ældste resterende medlem automatisk ejerskabet; en tom klan og dens klantider slettes.

## Scripts

- `npm run dev`: lokal udviklingsserver
- `npm run build`: produktionsbuild
- `npm run start`: start produktionsserveren
- `npm run lint`: ESLint
- `npm run typecheck`: TypeScript uden emit
- `npm test`: Vitest-tests
- `./scripts/docker.sh help`: alle Docker-kommandoer

## Produktion

Projektet kan deployes direkte på Vercel. Tilføj alle værdier fra `.env.example` som production environment variables. Vercels commit-ID reviderer automatisk PWA-cachen. På andre platforme skal `NEXT_PUBLIC_APP_VERSION` ændres ved en deployment, der skal tvinge en ny cache. Service worker registreres kun i production builds, så cache ikke forstyrrer lokal udvikling.

`SUPABASE_SERVICE_ROLE_KEY` og `AUTH_PASSWORD_PEPPER` er server-only og må aldrig eksponeres med `NEXT_PUBLIC_`.
