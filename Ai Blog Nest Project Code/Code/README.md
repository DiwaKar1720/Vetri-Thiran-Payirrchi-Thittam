# AI BlogNest API

A RESTful backend for a blogging platform, built with Node.js, Express and MongoDB (via Mongoose), secured with JWT authentication and bcrypt password hashing, and enhanced with Gemini-powered AI content tools.

## Features

- User registration and login (JWT-protected routes)
- Full blog CRUD (create, read, update, delete)
- Comment threads on each blog post
- AI-assisted blog generation
- AI-assisted content summarization
- MVC-style project layout

## Getting Started

1. Create a `.env` file (see Environment Variables below).
2. Install dependencies:

```bash
npm install
```

3. Run the server:

```bash
npm run dev
```

## Environment Variables

- `PORT`
- `MONGO_URI`
- `JWT_SECRET`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`

## API Endpoints

### Auth
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/profile`

### Blogs
- `POST /api/blogs`
- `GET /api/blogs`
- `GET /api/blogs/:id`
- `PUT /api/blogs/:id`
- `DELETE /api/blogs/:id`

### Comments
- `POST /api/comments/:blogId`
- `GET /api/comments/:blogId`
- `PUT /api/comments/:id`
- `DELETE /api/comments/:id`

### AI
- `POST /api/ai/generate-blog`
- `POST /api/ai/summarize`

## Testing

Import the included Thunder Client collection (or use Postman) to exercise each endpoint with sample JSON payloads.
