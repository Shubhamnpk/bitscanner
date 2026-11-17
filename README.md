# BitScanner

> A private, client-side, offline-first document scanner and studio PWA built with React 19, TypeScript, and Tailwind CSS.

BitScanner turns any modern web browser into a full-featured document scanning and export workstation. It runs entirely inside your browser using WebAssembly, Web Workers, and HTML5 Canvas—ensuring that your documents, scans, signatures, and credentials never touch a remote server.

---

## Key Capabilities

### 📷 Smart Camera & Quad Detection
- **Real-Time Edge Detection**: Live computer-vision edge detector with convex hull quad analysis, corner smoothing, and perspective rectification.
- **Auto Capture & Multi-Page Scanning**: Automatically detects steady pages and triggers captures, or batch-scans multi-page documents seamlessly.
- **Dedicated Capture Modes**: Document scan, Dual-sided ID card layout, Book spread split, and QR Code detection.

### 🎨 Studio Document Editor
- **Color Filters**: Magic Color enhancement, crisp B&W binarization, Grayscale, and Original finish.
- **Markup & Annotations**: Ink pen, text stamps, highlighters, shape callouts (rectangles, circles, arrows, lines), and blackout/whiteout redactions.
- **Signature Studio**: Create, save, and overlay digital signatures directly onto documents with customizable ink and opacity.

### ⚡ Client-Side OCR & Layout Reconstruction
- **In-Browser Tesseract Engine**: Local OCR recognition supporting English, Spanish, French, and German without external API calls.
- **Intelligent Layout Parsing**: Distinguishes headings, bullet lists, key-value metadata, and multi-column tables.
- **Structured Data Export**: Copy extracted text as plain text or formatted Markdown tables.

### 📡 Offline QR File Beam
- **Optical Transfer**: Stream documents or files up to 5 MB directly between devices using high-density animated QR codes.
- **Zero Internet Required**: Transmit data screen-to-camera with CRC error checking, duplicate resilience, and automatic chunk reassembly.

### 🛠️ PDF & Image Utility Suite
- **Images to PDF**: Combine multiple scans or photos into a unified PDF with customizable paper formats (A4, Letter, Fit).
- **PDF to Images**: Extract pages from existing PDFs into high-resolution PNG or JPEG images.
- **Passport Photo Maker**: Generate standard 35x45mm or 2x2in portrait photos with background presets on printable 4x6" and A4 sheets.
- **Merge PDFs**: Combine multiple PDF files client-side.

---

## Tech Stack

- **Framework**: [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **Bundler & Tooling**: [Vite](https://vite.dev/) + [Tailwind CSS v4](https://tailwindcss.com/)
- **PWA & Offline**: [Vite PWA Plugin](https://vite-pwa-org.netlify.app/) + Service Workers
- **OCR Engine**: [Tesseract.js](https://tesseract.projectnaptha.com/) (WebAssembly & Web Workers)
- **PDF Processing**: [PDF.js](https://mozilla.github.io/pdf.js/) & [jsPDF](https://github.com/parallax/jsPDF)
- **QR Optical Transfer**: [qrcode](https://github.com/soldair/node-qrcode) & [jsQR](https://github.com/cozmo/jsQR)
- **Icons**: [Lucide React](https://lucide.dev/)

---

## Getting Started

### Prerequisites
- Node.js (v18+) or [Bun](https://bun.sh/) (v1.0+)

### Installation

```bash
# Clone the repository
git clone https://github.com/Shubhamnpk/bitscanner.git
cd bitscanner

# Install dependencies
bun install
# or
npm install
```

### Development Server

```bash
bun run dev
# or
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Running Tests

```bash
bun test
```

### Building for Production

```bash
bun run build
# or
npm run build
```

The production output will be generated in the `dist/` directory.

---

## Privacy & Security

BitScanner is engineered around strict local-first privacy:
- **100% Client-Side**: All document processing, OCR, perspective transformation, and PDF compilation take place inside the browser's sandbox.
- **No Cloud Uploads**: Scanned documents and personal signatures are saved locally in browser storage (IndexedDB / LocalStorage).
- **Offline Capable**: The application is an installable PWA that functions entirely without an active internet connection.

---

## License

This project is licensed under the [MIT License](LICENSE).
