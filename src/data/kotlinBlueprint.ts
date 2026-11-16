export interface KotlinFileSpec {
  filename: string;
  packagePath: string;
  summary: string;
  dependencies: string;
  code: string;
}

export const KOTLIN_BLUEPRINT_FILES: KotlinFileSpec[] = [
  {
    filename: 'ScannerCameraScreen.kt',
    packagePath: 'app/src/main/java/com/camscan/studio/ui/ScannerCameraScreen.kt',
    summary: 'Jetpack Compose + CameraX live viewfinder with real-time document quad overlay, batch capture queue, and flash toggle.',
    dependencies: 'androidx.camera:camera-camera2, androidx.camera:camera-lifecycle, androidx.camera:camera-view',
    code: `package com.camscan.studio.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.camscan.studio.cv.PerspectiveDewarp
import java.io.File
import java.util.concurrent.Executors

@Composable
fun ScannerCameraScreen(
    batchMode: Boolean,
    onPagesCaptured: (List<Bitmap>) -> Unit,
    onClose: () -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val analysisExecutor = remember { Executors.newSingleThreadExecutor() }

    var imageCapture by remember { mutableStateOf<ImageCapture?>(null) }
    var flashEnabled by remember { mutableStateOf(false) }
    var detectedQuad by remember { mutableStateOf(PerspectiveDewarp.defaultQuad()) }
    val capturedBatch = remember { mutableStateListOf<Bitmap>() }

    Box(modifier = Modifier.fillMaxSize()) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                val previewView = PreviewView(ctx)
                val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)
                cameraProviderFuture.addListener({
                    val cameraProvider = cameraProviderFuture.get()
                    val preview = Preview.Builder().build().also {
                        it.setSurfaceProvider(previewView.surfaceProvider)
                    }

                    val capture = ImageCapture.Builder()
                        .setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
                        .build()
                    imageCapture = capture

                    val analyzer = ImageAnalysis.Builder()
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build()
                        .also { analysis ->
                            analysis.setAnalyzer(analysisExecutor) { imageProxy ->
                                detectedQuad = PerspectiveDewarp.detectDocumentQuad(imageProxy)
                                imageProxy.close()
                            }
                        }

                    cameraProvider.unbindAll()
                    val camera = cameraProvider.bindToLifecycle(
                        lifecycleOwner,
                        CameraSelector.DEFAULT_BACK_CAMERA,
                        preview,
                        capture,
                        analyzer
                    )
                    camera.cameraControl.enableTorch(flashEnabled)
                }, ContextCompat.getMainExecutor(ctx))
                previewView
            }
        )

        // Real-time edge quad overlay
        Canvas(modifier = Modifier.fillMaxSize()) {
            val pts = detectedQuad.map { Offset(it.x * size.width, it.y * size.height) }
            val path = Path().apply {
                moveTo(pts[0].x, pts[0].y)
                lineTo(pts[1].x, pts[1].y)
                lineTo(pts[2].x, pts[2].y)
                lineTo(pts[3].x, pts[3].y)
                close()
            }
            drawPath(path, color = Color(0xFF14B8A6).copy(alpha = 0.16f))
            drawPath(path, color = Color(0xFF0D9488), style = Stroke(width = 6f))
        }

        Row(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(24.dp)
                .fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            TextButton(onClick = onClose) { Text("Cancel", color = Color.White) }

            Button(
                onClick = {
                    capturePhoto(context, imageCapture) { bitmap ->
                        if (batchMode) {
                            capturedBatch.add(bitmap)
                        } else {
                            onPagesCaptured(listOf(bitmap))
                        }
                    }
                }
            ) { Text("Capture") }

            if (batchMode && capturedBatch.isNotEmpty()) {
                Button(onClick = { onPagesCaptured(capturedBatch.toList()) }) {
                    Text("Done (\${capturedBatch.size})")
                }
            }
        }
    }
}

private fun capturePhoto(
    context: Context,
    imageCapture: ImageCapture?,
    onResult: (Bitmap) -> Unit
) {
    val capture = imageCapture ?: return
    val outFile = File(context.cacheDir, "scan_\${System.currentTimeMillis()}.jpg")
    val outputOptions = ImageCapture.OutputFileOptions.Builder(outFile).build()
    capture.takePicture(
        outputOptions,
        ContextCompat.getMainExecutor(context),
        object : ImageCapture.OnImageSavedCallback {
            override fun onImageSaved(output: ImageCapture.OutputFileResults) {
                val bmp = BitmapFactory.decodeFile(outFile.absolutePath)
                if (bmp != null) onResult(bmp)
            }
            override fun onError(exception: ImageCaptureException) { /* Handle error */ }
        }
    )
}`,
  },
  {
    filename: 'PerspectiveDewarp.kt',
    packagePath: 'app/src/main/java/com/camscan/studio/cv/PerspectiveDewarp.kt',
    summary: 'OpenCV Android (or pure Kotlin Matrix.setPolyToPoly) automatic Canny edge contour finder + 4-corner perspective warp.',
    dependencies: 'org.opencv:opencv:4.9.0 (or Android android.graphics.Matrix)',
    code: `package com.camscan.studio.cv

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.PointF
import androidx.camera.core.ImageProxy
import org.opencv.android.Utils
import org.opencv.core.*
import org.opencv.imgproc.Imgproc
import kotlin.math.hypot
import kotlin.math.max

object PerspectiveDewarp {

    fun defaultQuad(): List<PointF> = listOf(
        PointF(0.08f, 0.08f),
        PointF(0.92f, 0.08f),
        PointF(0.92f, 0.92f),
        PointF(0.08f, 0.92f)
    )

    /**
     * Detects largest 4-point document contour via GaussianBlur + Canny + approxPolyDP.
     */
    fun detectDocumentQuad(imageProxy: ImageProxy): List<PointF> {
        val yBuffer = imageProxy.planes[0].buffer
        val w = imageProxy.width
        val h = imageProxy.height
        val yBytes = ByteArray(yBuffer.remaining())
        yBuffer.get(yBytes)

        val gray = Mat(h, w, CvType.CV_8UC1)
        gray.put(0, 0, yBytes)

        val blurred = Mat()
        val edges = Mat()
        Imgproc.GaussianBlur(gray, blurred, Size(5.0, 5.0), 0.0)
        Imgproc.Canny(blurred, edges, 55.0, 160.0)

        val contours = ArrayList<MatOfPoint>()
        Imgproc.findContours(edges, contours, Mat(), Imgproc.RETR_LIST, Imgproc.CHAIN_APPROX_SIMPLE)
        contours.sortByDescending { Imgproc.contourArea(it) }

        val minArea = w * h * 0.08
        for (contour in contours.take(8)) {
            if (Imgproc.contourArea(contour) < minArea) break
            val c2f = MatOfPoint2f(*contour.toArray())
            val peri = Imgproc.arcLength(c2f, true)
            val approx = MatOfPoint2f()
            Imgproc.approxPolyDP(c2f, approx, 0.02 * peri, true)
            if (approx.total() == 4L) {
                val pts = approx.toArray().map { PointF((it.x / w).toFloat(), (it.y / h).toFloat()) }
                return orderCorners(pts)
            }
        }
        return defaultQuad()
    }

    /**
     * Warps skewed quadrilateral corners into a crisp upright rectangular Bitmap.
     */
    fun warpPerspective(source: Bitmap, normalizedQuad: List<PointF>, maxDim: Int = 1800): Bitmap {
        val sw = source.width.toFloat()
        val sh = source.height.toFloat()
        val tl = PointF(normalizedQuad[0].x * sw, normalizedQuad[0].y * sh)
        val tr = PointF(normalizedQuad[1].x * sw, normalizedQuad[1].y * sh)
        val br = PointF(normalizedQuad[2].x * sw, normalizedQuad[2].y * sh)
        val bl = PointF(normalizedQuad[3].x * sw, normalizedQuad[3].y * sh)

        val rawW = max(hypot(tr.x - tl.x, tr.y - tl.y), hypot(br.x - bl.x, br.y - bl.y))
        val rawH = max(hypot(bl.x - tl.x, bl.y - tl.y), hypot(br.x - tr.x, br.y - tr.y))
        val scale = minOf(1f, maxDim / max(rawW, rawH))

        val outW = max(64, (rawW * scale).toInt())
        val outH = max(64, (rawH * scale).toInt())

        val srcMat = Mat()
        Utils.bitmapToMat(source, srcMat)
        val srcPts = MatOfPoint2f(
            Point(tl.x.toDouble(), tl.y.toDouble()),
            Point(tr.x.toDouble(), tr.y.toDouble()),
            Point(br.x.toDouble(), br.y.toDouble()),
            Point(bl.x.toDouble(), bl.y.toDouble())
        )
        val dstPts = MatOfPoint2f(
            Point(0.0, 0.0),
            Point(outW.toDouble(), 0.0),
            Point(outW.toDouble(), outH.toDouble()),
            Point(0.0, outH.toDouble())
        )

        val transform = Imgproc.getPerspectiveTransform(srcPts, dstPts)
        val dstMat = Mat()
        Imgproc.warpPerspective(srcMat, dstMat, transform, Size(outW.toDouble(), outH.toDouble()))

        val result = Bitmap.createBitmap(outW, outH, Bitmap.Config.ARGB_8888)
        Utils.matToBitmap(dstMat, result)
        return result
    }

    private fun orderCorners(pts: List<PointF>): List<PointF> {
        val tl = pts.minBy { it.x + it.y }
        val br = pts.maxBy { it.x + it.y }
        val tr = pts.minBy { it.y - it.x }
        val bl = pts.maxBy { it.y - it.x }
        return listOf(tl, tr, br, bl)
    }
}`,
  },
  {
    filename: 'ImageEnhancer.kt',
    packagePath: 'app/src/main/java/com/camscan/studio/cv/ImageEnhancer.kt',
    summary: 'OpenCV / Android Bitmap filters: Magic Color illumination normalization, Adaptive B&W Sauvola threshold, Shadow Removal, and Grayscale.',
    dependencies: 'org.opencv:opencv:4.9.0',
    code: `package com.camscan.studio.cv

import android.graphics.Bitmap
import org.opencv.android.Utils
import org.opencv.core.*
import org.opencv.imgproc.Imgproc

enum class FilterPreset {
    ORIGINAL, MAGIC_COLOR, LIGHTEN, GRAYSCALE, BW_ADAPTIVE, SHADOW_REMOVE
}

object ImageEnhancer {

    fun applyFilter(source: Bitmap, preset: FilterPreset): Bitmap {
        if (preset == FilterPreset.ORIGINAL) return source

        val srcMat = Mat()
        Utils.bitmapToMat(source, srcMat)
        val dstMat = Mat()

        when (preset) {
            FilterPreset.GRAYSCALE -> {
                Imgproc.cvtColor(srcMat, dstMat, Imgproc.COLOR_RGBA2GRAY)
                Imgproc.cvtColor(dstMat, dstMat, Imgproc.COLOR_GRAY2RGBA)
            }
            FilterPreset.BW_ADAPTIVE -> {
                val gray = Mat()
                Imgproc.cvtColor(srcMat, gray, Imgproc.COLOR_RGBA2GRAY)
                Imgproc.adaptiveThreshold(
                    gray, dstMat, 255.0,
                    Imgproc.ADAPTIVE_THRESH_GAUSSIAN_C,
                    Imgproc.THRESH_BINARY, 25, 11.0
                )
                Imgproc.cvtColor(dstMat, dstMat, Imgproc.COLOR_GRAY2RGBA)
            }
            FilterPreset.SHADOW_REMOVE, FilterPreset.MAGIC_COLOR -> {
                // Morphological dilation illumination division removes uneven shadows
                val rgb = Mat()
                Imgproc.cvtColor(srcMat, rgb, Imgproc.COLOR_RGBA2RGB)
                val planes = ArrayList<Mat>()
                Core.split(rgb, planes)
                val kernel = Imgproc.getStructuringElement(Imgproc.MORPH_ELLIPSE, Size(21.0, 21.0))

                val normalizedPlanes = planes.map { ch ->
                    val dilated = Mat()
                    val bg = Mat()
                    val norm = Mat()
                    Imgproc.dilate(ch, dilated, kernel)
                    Imgproc.medianBlur(dilated, bg, 21)
                    Core.divide(ch, bg, norm, 255.0)
                    if (preset == FilterPreset.MAGIC_COLOR) {
                        norm.convertTo(norm, -1, 1.22, -18.0)
                    }
                    norm
                }
                Core.merge(normalizedPlanes, dstMat)
                Imgproc.cvtColor(dstMat, dstMat, Imgproc.COLOR_RGB2RGBA)
            }
            FilterPreset.LIGHTEN -> {
                srcMat.convertTo(dstMat, -1, 1.12, 24.0)
            }
            FilterPreset.ORIGINAL -> srcMat.copyTo(dstMat)
        }

        val out = Bitmap.createBitmap(dstMat.cols(), dstMat.rows(), Bitmap.Config.ARGB_8888)
        Utils.matToBitmap(dstMat, out)
        return out
    }
}`,
  },
  {
    filename: 'IdCardCompositor.kt',
    packagePath: 'app/src/main/java/com/camscan/studio/cv/IdCardCompositor.kt',
    summary: 'Dual-side ID Card 2-up A4 sheet compositor with ISO/IEC 7810 proportions, dashed cut guides, and optional KYC watermark.',
    dependencies: 'Android Graphics Canvas (Zero external dependencies)',
    code: `package com.camscan.studio.cv

import android.graphics.*

object IdCardCompositor {

    fun composeA4Sheet(
        front: Bitmap,
        back: Bitmap,
        showCutGuides: Boolean = true,
        watermarkText: String? = null
    ): Bitmap {
        val pageW = 1240
        val pageH = 1754
        val sheet = Bitmap.createBitmap(pageW, pageH, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(sheet)
        canvas.drawColor(Color.WHITE)

        val cardW = (pageW * 0.68f).toInt()
        val cardH = (cardW / (85.6f / 53.98f)).toInt()
        val gap = (pageH * 0.065f).toInt()
        val startX = (pageW - cardW) / 2
        val startY = (pageH - (cardH * 2 + gap)) / 2

        val frontRect = RectF(startX.toFloat(), startY.toFloat(), (startX + cardW).toFloat(), (startY + cardH).toFloat())
        val backRect = RectF(startX.toFloat(), (startY + cardH + gap).toFloat(), (startX + cardW).toFloat(), (startY + cardH * 2 + gap).toFloat())

        val imgPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
        canvas.drawBitmap(front, null, frontRect, imgPaint)
        canvas.drawBitmap(back, null, backRect, imgPaint)

        if (showCutGuides) {
            val dashPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.parseColor("#94A3B8")
                strokeWidth = 2f
                style = Paint.Style.STROKE
                pathEffect = DashPathEffect(floatArrayOf(12f, 10f), 0f)
            }
            val midY = startY + cardH + gap / 2f
            canvas.drawLine(80f, midY, pageW - 80f, midY, dashPaint)
        }

        if (!watermarkText.isNullOrBlank()) {
            val wmPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.argb(46, 15, 23, 42)
                textSize = 42f
                typeface = Typeface.DEFAULT_BOLD
                textAlign = Paint.Align.CENTER
            }
            listOf(frontRect, backRect).forEach { rect ->
                canvas.save()
                canvas.translate(rect.centerX(), rect.centerY())
                canvas.rotate(-24f)
                canvas.drawText(watermarkText, 0f, 0f, wmPaint)
                canvas.restore()
            }
        }
        return sheet
    }
}`,
  },
  {
    filename: 'PdfAndOcrService.kt',
    packagePath: 'app/src/main/java/com/camscan/studio/export/PdfAndOcrService.kt',
    summary: 'Free on-device ML Kit OCR text extraction + Android native multi-page PdfDocument generator (A4/Letter/Fit).',
    dependencies: 'com.google.mlkit:text-recognition, android.graphics.pdf.PdfDocument',
    code: `package com.camscan.studio.export

import android.graphics.Bitmap
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.pdf.PdfDocument
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.io.File
import java.io.FileOutputStream
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.coroutines.suspendCoroutine

object PdfAndOcrService {

    suspend fun extractTextFree(bitmap: Bitmap): String = suspendCoroutine { cont ->
        val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        val input = InputImage.fromBitmap(bitmap, 0)
        recognizer.process(input)
            .addOnSuccessListener { visionText -> cont.resume(visionText.text) }
            .addOnFailureListener { err -> cont.resumeWithException(err) }
    }

    fun exportMultiPagePdf(pages: List<Bitmap>, outFile: File, marginPt: Int = 24): File {
        val pdf = PdfDocument()
        val a4WidthPt = 595
        val a4HeightPt = 842
        val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)

        pages.forEachIndexed { index, bmp ->
            val pageInfo = PdfDocument.PageInfo.Builder(a4WidthPt, a4HeightPt, index + 1).create()
            val page = pdf.startPage(pageInfo)

            val availW = (a4WidthPt - marginPt * 2).toFloat()
            val availH = (a4HeightPt - marginPt * 2).toFloat()
            val scale = minOf(availW / bmp.width, availH / bmp.height)
            val drawW = bmp.width * scale
            val drawH = bmp.height * scale
            val left = marginPt + (availW - drawW) / 2f
            val top = marginPt + (availH - drawH) / 2f

            page.canvas.drawBitmap(bmp, null, RectF(left, top, left + drawW, top + drawH), paint)
            pdf.finishPage(page)
        }

        FileOutputStream(outFile).use { stream -> pdf.writeTo(stream) }
        pdf.close()
        return outFile
    }
}`,
  },
];
