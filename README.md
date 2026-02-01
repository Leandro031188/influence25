# Influencer Funnel (Instagram Connect) — Full Stack Starter

Este projeto entrega um funil completo (front + backend) para:
- Página "Quero ser influencer"
- Consentimento GDPR (granular) + logs
- Conectar Instagram via OAuth (Meta)
- Pipeline de qualificação (MVP) + score A/B/C
- Dashboard do influencer + painel admin
- Export básico para CRM (CSV)

## Stack
- Backend: Node.js + Express
- DB: SQLite (arquivo local) via better-sqlite3
- Frontend: HTML + Tailwind (CDN) + JS (fetch)
- Jobs: simples (processa na hora no MVP)

## O que você precisa configurar (obrigatório)
1. Criar um App no Meta for Developers e habilitar o fluxo de login/Instagram:
   - Definir "Valid OAuth Redirect URIs" apontando para:
     `https://SEU-DOMINIO.com/api/oauth/meta/callback`
2. Adicionar variáveis de ambiente no servidor (veja `.env.example`).
3. Subir o projeto no seu servidor (VPS, Render, Railway, etc.) com HTTPS.

> Importante: sem essas configs do Meta, o login não funciona (por design).

## Rodar localmente
1. Instale Node 18+.
2. Copie `.env.example` para `.env` e preencha.
3. Rode:
   ```bash
   cd server
   npm install
   npm run dev
   ```
4. Abra:
   - Landing: http://localhost:8080
   - Admin: http://localhost:8080/admin

## Estrutura
- `server/` backend + rotas + DB
- `public/` frontend estático

## Endpoints principais
- `POST /api/lead` cria o lead e registra o consentimento
- `GET /api/oauth/meta/start?creator_id=...` inicia OAuth
- `GET /api/oauth/meta/callback` callback do Meta
- `GET /api/creator/:id/overview` dashboard do creator
- `POST /api/creator/:id/share-enable` habilita compartilhamento com marcas
- `GET /api/admin/creators` lista creators (com filtro)
- `GET /api/admin/export.csv` export CSV

## Segurança/Compliance (MVP)
- Consentimento versionado + hash
- Revogação e exclusão
- Sem scraping/bots
- Tokens criptografados em repouso (AES-256 com chave do `.env`)
