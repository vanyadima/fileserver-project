# File storage with admin panel

Two separate websites on different ports:

- Public file storage: `http://localhost:3000`
- Admin panel: `http://localhost:3001`
- API: `http://localhost:4000`

## What is included

- Admin login in JavaScript
- Tag editor
- Filter editor with dropdowns and checkboxes
- Multiple file upload at once
- File deletion from admin
- Tag removal without deleting files
- Public search by file name and tags
- Filters pulled from admin configuration
- Folder grouping
- Direct download of the real file
- Docker Compose setup

## Run with Docker

```bash
docker compose up --build
```

## Default admin password

`admin123`

Change it in `docker-compose.yml`.

## Storage location

Uploaded files are stored in `./storage-data` because that folder is mounted into the containers as `STORAGE_DIR`. If you want to point the storage site to another folder, change the bind mount in `docker-compose.yml`.

## Notes

This project uses a JSON store for metadata, so it is easy to inspect and move. It is suitable for small and medium deployments.
