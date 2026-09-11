# Codex + Git Workflow

## Ticket Workflow

```mermaid
flowchart TD

    A["Pick next unblocked MKT ticket"]
    B["git checkout main<br/>git pull"]
    C["Create branch<br/>feat/mkt-xxx-short-name"]
    D["Codex reads<br/>AGENTS + PRD + PLAN + STATUS"]
    E["Inspect actual repository"]
    F{"Ticket 5–8 SP?"}
    G["Analyze architecture/risks first"]
    H["Implement current ticket only"]
    I["Run build / typecheck / ticket tests"]
    J{"Checks pass?"}
    K["Fix current ticket"]
    L["Review git diff"]
    M{"Only scoped changes?"}
    N["Remove/revert unrelated diff"]
    O["Update STATUS.md"]
    P["git add relevant files"]
    Q["Commit / push"]
    R["Review / PR"]
    S{"Approved?"}
    T["Fix review feedback"]
    U["Squash/merge to main"]
    V["git checkout main<br/>git pull"]
    W{"More tickets?"}
    X["Pick next unblocked ticket"]
    Y(["Release complete"])

    A --> B --> C --> D --> E --> F
    F -- Yes --> G --> H
    F -- No --> H
    H --> I --> J
    J -- No --> K --> I
    J -- Yes --> L --> M
    M -- No --> N --> L
    M -- Yes --> O --> P --> Q --> R --> S
    S -- No --> T --> I
    S -- Yes --> U --> V --> W
    W -- Yes --> X --> A
    W -- No --> Y
```

## Six-Sprint Flow

```mermaid
flowchart TD
    START(["Start"])

    START --> S1["Sprint 1<br/>TanStack Start Foundation<br/>MKT-101 → 102 → 202 → 203"]
    S1 --> G1{"G1 Architecture Ready?"}
    G1 -- No --> S1FIX["Fix G1 blockers"] --> G1
    G1 -- Yes --> S2

    S2["Sprint 2<br/>Core UI + Media<br/>204/205 + 301/302/303/305"]
    S2 --> G2{"G2 UI Foundation Ready?"}
    G2 -- No --> S2FIX["Fix G2 blockers"] --> G2
    G2 -- Yes --> S3

    S3["Sprint 3<br/>Production Pages<br/>306–312<br/>304 optional"]
    S3 --> G3{"G3 Feature Complete?"}
    G3 -- No --> S3FIX["Fix G3 blockers"] --> G3
    G3 -- Yes --> SPLIT{{"Parallel streams"}}

    SPLIT --> S4["Sprint 4<br/>TanStack Prerender + SEO<br/>401–408"]
    SPLIT --> S5["Sprint 5<br/>Fly App Migration<br/>501–507"]

    S4 --> G4{"G4 SSG/SEO Ready?"}
    G4 -- No --> S4FIX["Fix SSG/SEO"] --> G4

    S5 --> G5{"G5 App Ready?"}
    G5 -- No --> S5FIX["Fix app migration"] --> G5

    G4 -- Yes --> READY{{"Both streams ready"}}
    G5 -- Yes --> READY

    READY --> S6["Sprint 6<br/>Cloudflare + Cutover + QA<br/>601–609"]
    S6 --> CUT["MKT-602<br/>Root domain cutover"]
    CUT --> FINAL{"Release gates pass?"}

    FINAL -- No --> HOTFIX["Fix release blockers"] --> FINAL
    FINAL -- Yes --> RELEASE(["Release Complete"])
```

## Critical Path

```mermaid
flowchart LR
    A["MKT-101"] --> B["MKT-102"]
    B --> C["MKT-202"]
    C --> D["MKT-203"]
    D --> E["MKT-305"]
    E --> F["MKT-306–311"]
    F --> G["MKT-401<br/>TanStack prerender"]
    G --> H["MKT-403/404/405"]
    H --> I["MKT-407"]
    I --> J["MKT-601"]

    K["MKT-501"] --> L["MKT-502/503/504/505/506"]
    L --> M["MKT-507"]

    J --> N["MKT-602<br/>CUTOVER"]
    M --> N

    N --> O["MKT-603"]
    O --> P["MKT-608"]
    N --> Q["MKT-605"]
    J --> R["MKT-604"]

    P --> Z(["Release"])
    Q --> Z
    R --> Z
```

## Branch Naming

Examples:

```text
feat/mkt-101-tanstack-marketing-workspace
feat/mkt-102-tanstack-rsbuild-setup
feat/mkt-202-marketing-routes
feat/mkt-301-marketing-layout
feat/mkt-401-tanstack-prerender
feat/mkt-403-route-seo
fix/mkt-503-api-cors
chore/mkt-602-domain-cutover
```

## Commit Naming

Examples:

```text
feat(marketing): initialize tanstack start workspace [MKT-101]
build(marketing): configure tanstack start with rsbuild [MKT-102]
feat(marketing): add file-based marketing routes [MKT-202]
feat(marketing): add typed content layer [MKT-203]

feat(marketing): add global marketing layout [MKT-301]
feat(marketing): build hero showreel [MKT-302]
feat(portfolio): build bento portfolio grid [MKT-303]
feat(marketing): add reusable service template [MKT-305]

feat(ssg): configure tanstack start prerendering [MKT-401]
fix(ssr): resolve marketing hydration boundaries [MKT-402]
feat(seo): add route-native metadata [MKT-403]
feat(seo): add structured data [MKT-404]
feat(seo): configure tanstack sitemap [MKT-405]
feat(seo): add marketing robots.txt [MKT-406]
test(seo): validate static marketing output [MKT-407]

chore(fly): configure app subdomain [MKT-501]
refactor(app): migrate public app urls [MKT-502]
fix(api): update cors origins [MKT-503]
fix(auth): review app cookie scope [MKT-504]

ci(marketing): deploy prerendered site to cloudflare [MKT-601]
chore(domain): cut over root marketing domain [MKT-602]
feat(routing): redirect legacy app routes [MKT-603]
```

## Recommended Solo-Vibecoding Rule

```text
1 ticket
→ 1 branch
→ Codex implement
→ validate
→ review diff manually
→ update STATUS.md
→ 1 clean squash commit
→ merge main
→ pull main
→ next unblocked ticket
```

Do not keep MKT-101 through MKT-609 on one long-lived feature branch.
