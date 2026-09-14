# Production deployment

Бот разворачивается на Raspberry Pi и использует общие Directus, PostgreSQL и сетевой прокси платформы. Сам бот и его рабочие таблицы изолированы от других проектов.

## Production-контракт

- общая Directus CMS запущена из `bot-platform-infra`;
- существует Docker-сеть `bot_platform_backend`;
- для операционных таблиц бота выделены отдельная БД или отдельная схема и пользователь;
- код размещается в `/opt/telegram-service-bot`;
- секреты находятся в `/etc/bot-platform/bots/telegram-service-bot.env` с правами `600`;
- `BOT_VERSION` содержит точную SemVer-версию, не `latest`;
- runner имеет отдельный label `telegram-service-prod`.
- Telegram API доступен через `botcrm_xray_proxy` и `xray_vless:8080`;
- deploy считается успешным только после перехода healthcheck в `healthy`.

Production Compose не запускает собственный PostgreSQL и не открывает host-порты. В общем PostgreSQL созданы отдельные база и роль `telegram_service`.

## Ограничения

- подключать бот к базе BotCRM;
- создавать ещё один Directus;
- запускать старый и новый процесс с одним Telegram-токеном одновременно.

## Rollback после первой выкладки

Откат будет выполняться возвратом `BOT_VERSION` к предыдущему точному тегу и повторным запуском `scripts/deploy.sh`. База и CMS при откате образа не удаляются.
