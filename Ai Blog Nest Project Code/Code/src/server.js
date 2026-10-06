require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'development-secret';

const memory = {
  users: [],
  blogs: [],
  comments: [],
};

let dbReady = false;

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
  },
  { timestamps: true }
);

const commentSchema = new mongoose.Schema(
  {
    blogId: { type: mongoose.Schema.Types.ObjectId, ref: 'Blog', required: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

const blogSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    content: { type: String, required: true },
    category: { type: String, trim: true, default: 'General' },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    comments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Comment' }],
  },
  { timestamps: true }
);

const User = mongoose.models.User || mongoose.model('User', userSchema);
const Blog = mongoose.models.Blog || mongoose.model('Blog', blogSchema);
const Comment = mongoose.models.Comment || mongoose.model('Comment', commentSchema);

function toPublicUser(user) {
  const plain = user && user.toObject ? user.toObject() : user;
  const id = plain._id ? plain._id.toString() : plain.id;
  return {
    id,
    name: plain.name,
    email: plain.email,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
}

function toPublicBlog(blog) {
  const plain = blog && blog.toObject ? blog.toObject() : blog;
  const author = plain.author && typeof plain.author === 'object' ? plain.author : { id: plain.author, name: 'Unknown' };

  return {
    id: plain._id ? plain._id.toString() : plain.id,
    title: plain.title,
    content: plain.content,
    category: plain.category || 'General',
    author: typeof author === 'object' && author._id ? toPublicUser(author) : { id: author, name: 'Unknown' },
    comments: plain.comments || [],
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
}

function toPublicComment(comment) {
  const plain = comment && comment.toObject ? comment.toObject() : comment;
  return {
    id: plain._id ? plain._id.toString() : plain.id,
    blogId: plain.blogId ? plain.blogId.toString() : plain.blogId,
    author: plain.author ? (typeof plain.author === 'object' ? toPublicUser(plain.author) : { id: plain.author }) : null,
    text: plain.text,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
}

function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function connectDatabase() {
  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri || mongoUri.includes('<db_password>') || mongoUri.includes('YOUR_')) {
    console.warn('MONGO_URI is missing or still a placeholder; using local fallback database.');
    return false;
  }

  try {
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000,
    });
    dbReady = true;
    console.log('MongoDB connected successfully.');
    return true;
  } catch (error) {
    dbReady = false;
    console.warn('MongoDB connection failed. Falling back to in-memory storage:', error.message);
    return false;
  }
}

async function findUserByEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();

  if (dbReady) {
    return User.findOne({ email: normalized }).lean();
  }

  return memory.users.find((user) => user.email === normalized) || null;
}

async function createUser({ name, email, password }) {
  if (dbReady) {
    const user = await User.create({ name, email, password });
    return user;
  }

  const user = {
    _id: createId(),
    id: createId(),
    name,
    email: String(email).trim().toLowerCase(),
    password,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  memory.users.push(user);
  return user;
}

async function getUserById(userId) {
  if (dbReady) {
    return User.findById(userId).lean();
  }

  return memory.users.find((user) => user._id.toString() === String(userId)) || null;
}

async function getAllBlogs() {
  if (dbReady) {
    return Blog.find().populate('author', 'name email').populate('comments').lean();
  }

  return memory.blogs.map((blog) => ({
    ...blog,
    comments: (blog.comments || []).map((commentId) =>
      memory.comments.find((comment) => comment._id === commentId) || null
    ).filter(Boolean),
  }));
}

async function getBlogById(blogId) {
  if (dbReady) {
    return Blog.findById(blogId).populate('author', 'name email').populate('comments').lean();
  }

  return memory.blogs.find((blog) => blog._id.toString() === String(blogId)) || null;
}

async function createBlog({ title, content, category, authorId }) {
  if (dbReady) {
    return Blog.create({ title, content, category, author: authorId });
  }

  const blog = {
    _id: createId(),
    id: createId(),
    title,
    content,
    category,
    author: authorId,
    comments: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  memory.blogs.push(blog);
  return blog;
}

async function updateBlog(blogId, updates) {
  if (dbReady) {
    return Blog.findByIdAndUpdate(blogId, updates, { new: true }).populate('author', 'name email').lean();
  }

  const blog = memory.blogs.find((item) => item._id.toString() === String(blogId));
  if (!blog) return null;

  Object.assign(blog, updates, { updatedAt: new Date().toISOString() });
  return blog;
}

async function deleteBlog(blogId) {
  if (dbReady) {
    const blog = await Blog.findById(blogId);
    if (!blog) return false;
    await Comment.deleteMany({ blogId: blog._id });
    await Blog.findByIdAndDelete(blogId);
    return true;
  }

  const index = memory.blogs.findIndex((blog) => blog._id.toString() === String(blogId));
  if (index === -1) return false;

  const blog = memory.blogs[index];
  memory.comments = memory.comments.filter((comment) => !blog.comments.includes(comment._id));
  memory.blogs.splice(index, 1);
  return true;
}

async function getCommentById(commentId) {
  if (dbReady) {
    return Comment.findById(commentId).populate('author', 'name email').lean();
  }

  return memory.comments.find((comment) => comment._id.toString() === String(commentId)) || null;
}

async function getCommentsForBlog(blogId) {
  if (dbReady) {
    return Comment.find({ blogId }).populate('author', 'name email').lean();
  }

  return memory.comments.filter((comment) => comment.blogId.toString() === String(blogId));
}

async function createComment({ blogId, authorId, text }) {
  if (dbReady) {
    const newComment = await Comment.create({ blogId, author: authorId, text });
    await Blog.findByIdAndUpdate(blogId, { $push: { comments: newComment._id } });
    return newComment.populate('author', 'name email');
  }

  const comment = {
    _id: createId(),
    blogId,
    author: authorId,
    text,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  memory.comments.push(comment);

  const blog = memory.blogs.find((item) => item._id.toString() === String(blogId));
  if (blog) {
    blog.comments = blog.comments || [];
    blog.comments.push(comment._id);
  }

  return comment;
}

async function updateComment(commentId, text) {
  if (dbReady) {
    return Comment.findByIdAndUpdate(commentId, { text }, { new: true }).populate('author', 'name email').lean();
  }

  const comment = memory.comments.find((item) => item._id.toString() === String(commentId));
  if (!comment) return null;

  comment.text = text;
  comment.updatedAt = new Date().toISOString();
  return comment;
}

async function deleteComment(commentId) {
  if (dbReady) {
    const comment = await Comment.findById(commentId);
    if (!comment) return false;
    await Blog.findByIdAndUpdate(comment.blogId, { $pull: { comments: comment._id } });
    await Comment.findByIdAndDelete(commentId);
    return true;
  }

  const commentIndex = memory.comments.findIndex((comment) => comment._id.toString() === String(commentId));
  if (commentIndex === -1) return false;

  const removedComment = memory.comments[commentIndex];
  const blog = memory.blogs.find((item) => item._id.toString() === removedComment.blogId.toString());
  if (blog) {
    blog.comments = (blog.comments || []).filter((commentIdValue) => commentIdValue.toString() !== String(commentId));
  }

  memory.comments.splice(commentIndex, 1);
  return true;
}

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

function authorize(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Authorization token is required.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
}

function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  return next();
}

function createGeminiClient() {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.includes('YOUR_')) {
    return null;
  }

  try {
    return new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  } catch (error) {
    console.warn('Gemini client initialization failed:', error.message);
    return null;
  }
}

async function generateWithGemini(prompt) {
  const genAI = createGeminiClient();
  if (!genAI) {
    return null;
  }

  try {
    const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-1.5-flash' });
    const response = await model.generateContent(prompt);
    const text = response.response?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text)
      .join('') || response.response?.text?.() || null;

    return typeof text === 'string' ? text : null;
  } catch (error) {
    console.warn('Gemini request failed:', error.message);
    return null;
  }
}

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', dbReady, mode: dbReady ? 'database' : 'memory' });
});

app.post(
  '/api/auth/register',
  [
    body('name').trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters long.'),
    body('email').isEmail().withMessage('A valid email is required.'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long.'),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { name, email, password } = req.body;
      const existingUser = await findUserByEmail(email);

      if (existingUser) {
        return res.status(409).json({ message: 'User with this email already exists.' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await createUser({ name, email, password: hashedPassword });
      const token = signToken({ id: user._id ? user._id.toString() : user.id, email: user.email, name: user.name });

      return res.status(201).json({
        message: 'User registered successfully.',
        token,
        user: toPublicUser(user),
      });
    } catch (error) {
      return res.status(500).json({ message: 'Unable to register user.', error: error.message });
    }
  }
);

app.post(
  '/api/auth/login',
  [
    body('email').isEmail().withMessage('A valid email is required.'),
    body('password').notEmpty().withMessage('Password is required.'),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { email, password } = req.body;
      const user = await findUserByEmail(email);

      if (!user) {
        return res.status(401).json({ message: 'Invalid email or password.' });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({ message: 'Invalid email or password.' });
      }

      const token = signToken({ id: user._id ? user._id.toString() : user.id, email: user.email, name: user.name });

      return res.json({
        message: 'Login successful.',
        token,
        user: toPublicUser(user),
      });
    } catch (error) {
      return res.status(500).json({ message: 'Unable to log in.', error: error.message });
    }
  }
);

app.get('/api/auth/profile', authorize, async (req, res) => {
  try {
    const user = await getUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    return res.json({ user: toPublicUser(user) });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to fetch profile.', error: error.message });
  }
});

app.post('/api/blogs', authorize, async (req, res) => {
  try {
    const { title, content, category } = req.body;

    if (!title || !content) {
      return res.status(400).json({ message: 'Title and content are required.' });
    }

    const blog = await createBlog({
      title: String(title).trim(),
      content: String(content),
      category: category || 'General',
      authorId: req.user.id,
    });

    return res.status(201).json({ message: 'Blog created successfully.', blog: toPublicBlog(blog) });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to create blog.', error: error.message });
  }
});

app.get('/api/blogs', async (req, res) => {
  try {
    const blogs = await getAllBlogs();
    return res.json(blogs.map(toPublicBlog));
  } catch (error) {
    return res.status(500).json({ message: 'Unable to fetch blogs.', error: error.message });
  }
});

app.get('/api/blogs/:id', async (req, res) => {
  try {
    const blog = await getBlogById(req.params.id);
    if (!blog) {
      return res.status(404).json({ message: 'Blog not found.' });
    }
    return res.json(toPublicBlog(blog));
  } catch (error) {
    return res.status(500).json({ message: 'Unable to fetch blog details.', error: error.message });
  }
});

app.put('/api/blogs/:id', authorize, async (req, res) => {
  try {
    const { title, content, category } = req.body;
    const blog = await getBlogById(req.params.id);

    if (!blog) {
      return res.status(404).json({ message: 'Blog not found.' });
    }

    const existingAuthorId = blog.author && typeof blog.author === 'object' ? blog.author._id?.toString() || blog.author.toString() : String(blog.author);
    if (existingAuthorId !== req.user.id) {
      return res.status(403).json({ message: 'You can only update your own blog posts.' });
    }

    const updates = {};
    if (title) updates.title = String(title).trim();
    if (content) updates.content = String(content);
    if (category) updates.category = String(category).trim();

    const updatedBlog = await updateBlog(req.params.id, updates);
    return res.json({ message: 'Blog updated successfully.', blog: toPublicBlog(updatedBlog) });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to update blog.', error: error.message });
  }
});

app.delete('/api/blogs/:id', authorize, async (req, res) => {
  try {
    const blog = await getBlogById(req.params.id);
    if (!blog) {
      return res.status(404).json({ message: 'Blog not found.' });
    }

    const existingAuthorId = blog.author && typeof blog.author === 'object' ? blog.author._id?.toString() || blog.author.toString() : String(blog.author);
    if (existingAuthorId !== req.user.id) {
      return res.status(403).json({ message: 'You can only delete your own blog posts.' });
    }

    const deleted = await deleteBlog(req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: 'Blog not found.' });
    }

    return res.json({ message: 'Blog deleted successfully.' });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to delete blog.', error: error.message });
  }
});

app.get('/api/comments/:blogId', async (req, res) => {
  try {
    const comments = await getCommentsForBlog(req.params.blogId);
    return res.json(comments.map(toPublicComment));
  } catch (error) {
    return res.status(500).json({ message: 'Unable to fetch comments.', error: error.message });
  }
});

app.post('/api/comments/:blogId', authorize, async (req, res) => {
  try {
    const blog = await getBlogById(req.params.blogId);
    if (!blog) {
      return res.status(404).json({ message: 'Blog not found.' });
    }

    const text = String(req.body.text || '').trim();
    if (!text) {
      return res.status(400).json({ message: 'Comment text is required.' });
    }

    const comment = await createComment({ blogId: req.params.blogId, authorId: req.user.id, text });
    return res.status(201).json({ message: 'Comment added successfully.', comment: toPublicComment(comment) });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to create comment.', error: error.message });
  }
});

app.put('/api/comments/:id', authorize, async (req, res) => {
  try {
    const commentLookup = await getCommentById(req.params.id);
    if (!commentLookup) {
      return res.status(404).json({ message: 'Comment not found.' });
    }

    const authorId = commentLookup.author && typeof commentLookup.author === 'object' ? commentLookup.author._id?.toString() || commentLookup.author.toString() : String(commentLookup.author);
    if (authorId !== req.user.id) {
      return res.status(403).json({ message: 'You can only edit your own comments.' });
    }

    const text = String(req.body.text || '').trim();
    if (!text) {
      return res.status(400).json({ message: 'Comment text is required.' });
    }

    const updatedComment = await updateComment(req.params.id, text);
    return res.json({ message: 'Comment updated successfully.', comment: toPublicComment(updatedComment) });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to update comment.', error: error.message });
  }
});

app.delete('/api/comments/:id', authorize, async (req, res) => {
  try {
    const comment = await getCommentById(req.params.id);
    if (!comment) {
      return res.status(404).json({ message: 'Comment not found.' });
    }

    const authorId = comment.author && typeof comment.author === 'object' ? comment.author._id?.toString() || comment.author.toString() : String(comment.author);
    if (authorId !== req.user.id) {
      return res.status(403).json({ message: 'You can only delete your own comments.' });
    }

    const deleted = await deleteComment(req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: 'Comment not found.' });
    }

    return res.json({ message: 'Comment deleted successfully.' });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to delete comment.', error: error.message });
  }
});

app.post('/api/ai/generate-blog', async (req, res) => {
  try {
    const { topic } = req.body;
    if (!topic || !String(topic).trim()) {
      return res.status(400).json({ message: 'A topic is required.' });
    }

    const prompt = `Write a polished blog post about ${topic}. Include a compelling title, 4 sections, and a conclusion. Keep the tone informative and engaging.`;
    const generatedText = (await generateWithGemini(prompt)) || `# ${String(topic).trim()}\n\nThis is an AI-generated blog outline with an introduction, main sections, and closing thoughts.`;

    return res.json({
      title: String(topic).trim(),
      content: generatedText,
      generatedBy: 'gemini',
    });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to generate blog post.', error: error.message });
  }
});

app.post('/api/ai/summarize', async (req, res) => {
  try {
    const { content } = req.body;
    if (!content || !String(content).trim()) {
      return res.status(400).json({ message: 'Content is required.' });
    }

    const prompt = `Summarize the following blog content into a concise 3-sentence summary:\n\n${content}`;
    const summary = (await generateWithGemini(prompt)) || `${String(content).trim().split(/\s+/).slice(0, 30).join(' ')}...`;

    return res.json({ summary });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to summarize content.', error: error.message });
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  return res.status(500).json({ message: 'Something went wrong on the server.' });
});

if (require.main === module) {
  connectDatabase().then(() => {
    app.listen(PORT, () => {
      console.log(`AI BlogNest API running on http://localhost:${PORT}`);
    });
  });
}

module.exports = app;
