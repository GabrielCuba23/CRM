package com.nexocrm.mobile;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.text.InputType;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.json.JSONObject;

/** A narrow HTTPS container for the existing authenticated CRM web application. */
public final class MainActivity extends Activity {
    private static final String DEFAULT_ORIGIN = "https://nexo-crm.acxelcubaaraoz.workers.dev";
    private static final int OPEN_FILE = 10, SAVE_FILE = 11, MAX_DOWNLOAD = 8 * 1024 * 1024;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private SharedPreferences preferences;
    private String origin, accessTeam;
    private WebView web;
    private ProgressBar progress;
    private TextView notice;
    private ValueCallback<Uri[]> upload;
    private byte[] pendingDownload;
    private String pendingMime, pendingFilename;
    private OnBackInvokedCallback backCallback;
    private boolean destroyed = false, accessPromptOpen = false;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        preferences = getSharedPreferences("nexo-crm", MODE_PRIVATE);
        origin = preferences.getString("origin", DEFAULT_ORIGIN);
        accessTeam = preferences.getString("accessTeam", "");
        try { origin = UrlPolicy.normalizeOrigin(origin); }
        catch (IllegalArgumentException error) { origin = DEFAULT_ORIGIN; }
        try { accessTeam = UrlPolicy.accessHost(accessTeam); }
        catch (IllegalArgumentException error) { accessTeam = ""; }
        createViews();
        configureWebView();
        if (Build.VERSION.SDK_INT >= 33) {
            backCallback = new OnBackInvokedCallback() {
                @Override public void onBackInvoked() { goBack(); }
            };
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
        }
        if (state == null || web.restoreState(state) == null) web.loadUrl(origin + "/");
        if (!preferences.getBoolean("configured", false)) showSettings();
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private void createViews() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setFitsSystemWindows(true);
        root.setBackgroundColor(Color.WHITE);
        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(12), dp(4), dp(8), dp(4));
        toolbar.setBackgroundColor(Color.rgb(74, 46, 155));
        TextView title = new TextView(this);
        title.setText("Nexo CRM");
        title.setTextSize(19);
        title.setTextColor(Color.WHITE);
        toolbar.addView(title, new LinearLayout.LayoutParams(0, dp(48), 1));
        Button refresh = toolbarButton("↻", "Recargar el CRM");
        refresh.setOnClickListener(v -> web.reload());
        toolbar.addView(refresh);
        Button menu = toolbarButton("⋮", "Opciones del CRM");
        menu.setOnClickListener(v -> showMenu());
        toolbar.addView(menu);
        root.addView(toolbar);
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        root.addView(progress, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)));
        notice = new TextView(this);
        notice.setPadding(dp(14), dp(10), dp(14), dp(10));
        notice.setTextColor(Color.rgb(85, 49, 0));
        notice.setBackgroundColor(Color.rgb(255, 243, 218));
        notice.setVisibility(View.GONE);
        notice.setOnClickListener(v -> web.loadUrl(origin + "/"));
        root.addView(notice);
        web = new WebView(this);
        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(root);
    }

    private Button toolbarButton(String text, String description) {
        Button button = new Button(this);
        button.setText(text);
        button.setContentDescription(description);
        button.setTextColor(Color.WHITE);
        button.setTextSize(23);
        button.setBackgroundColor(Color.TRANSPARENT);
        button.setMinWidth(0);
        button.setMinimumWidth(0);
        button.setLayoutParams(new LinearLayout.LayoutParams(dp(48), dp(48)));
        return button;
    }

    @SuppressWarnings("deprecation") private void configureWebView() {
        WebView.setWebContentsDebuggingEnabled(false);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSafeBrowsingEnabled(true);
        // User-chosen documents are provided by Android's Storage Access Framework.
        // No filesystem or contacts permission and no JavaScript-to-native interface.
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                return routeNavigation(request.getUrl().toString(), request.hasGesture());
            }

            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                notice.setVisibility(View.GONE);
                // Restored state must obey the current origin policy too.
                if (!UrlPolicy.isCrm(url, origin) && !UrlPolicy.isAccess(url, accessTeam)) {
                    view.stopLoading();
                    routeNavigation(url, false);
                }
            }

            @Override public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();
            }

            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
                showNotice("No se pudo verificar el certificado HTTPS. Revisa la dirección y la conexión.");
            }

            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showNotice(
                        "No se pudo abrir el CRM. Comprueba Internet y que el CRM esté publicado. Toca aquí para reintentar.");
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int value) {
                progress.setProgress(value);
                progress.setVisibility(value < 100 ? View.VISIBLE : View.GONE);
            }

            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> result,
                    FileChooserParams parameters) {
                if (!UrlPolicy.isCrm(view.getUrl(), origin)) return false;
                if (upload != null) upload.onReceiveValue(null);
                upload = result;
                Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                pick.setType("*/*");
                pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,
                        parameters.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try { startActivityForResult(pick, OPEN_FILE); }
                catch (ActivityNotFoundException error) {
                    upload.onReceiveValue(null); upload = null;
                    toast("No se encontró un selector de archivos.");
                }
                return true;
            }

            @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean userGesture, Message result) {
                if (!userGesture || !UrlPolicy.isCrm(view.getUrl(), origin)) return false;
                final WebView popup = new WebView(MainActivity.this);
                popup.setWebViewClient(new WebViewClient() {
                    @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                        String url = request.getUrl().toString();
                        if (UrlPolicy.isCrm(url, origin)) web.loadUrl(url);
                        else openExternal(url, true);
                        popup.destroy();
                        return true;
                    }
                });
                ((WebView.WebViewTransport) result.obj).setWebView(popup);
                result.sendToTarget();
                return true;
            }
        });
        web.setDownloadListener((url, userAgent, disposition, mime, length) -> {
            if (!UrlPolicy.isCrm(web.getUrl(), origin)) {
                toast("Abre el CRM para descargar sus archivos."); return;
            }
            String filename = android.webkit.URLUtil.guessFileName(url, disposition, mime);
            if (UrlPolicy.isCrmBlob(url, origin)) exportBlob(url, filename, mime);
            else if (UrlPolicy.isCrm(url, origin)) exportHttps(url, filename, mime, false);
            else toast("La descarga debe pertenecer a tu CRM.");
        });
    }

    private boolean routeNavigation(String url, boolean gesture) {
        if (UrlPolicy.isCrmBlob(url, origin) && UrlPolicy.isCrm(web.getUrl(), origin)) {
            exportBlob(url, null, null);
            return true;
        }
        if (UrlPolicy.isCrm(url, origin) || UrlPolicy.isAccess(url, accessTeam)) return false;
        String candidate = UrlPolicy.candidateAccessHost(url);
        if (!candidate.isEmpty() && accessTeam.isEmpty()) {
            if (!accessPromptOpen) {
                accessPromptOpen = true;
                new AlertDialog.Builder(this)
                    .setTitle("Iniciar sesión con Cloudflare Access")
                    .setMessage("¿Permitir el inicio de sesión en este equipo?\n\n" + candidate
                            + "\n\nSolo se autorizará este dominio para esta aplicación.")
                    .setPositiveButton("Permitir", (d, which) -> {
                        accessTeam = candidate;
                        preferences.edit().putString("accessTeam", candidate).apply();
                        web.loadUrl(url);
                    })
                    .setNegativeButton("Cancelar", null)
                    .setOnDismissListener(d -> accessPromptOpen = false).show();
            }
            return true;
        }
        openExternal(url, gesture);
        return true;
    }

    private void openExternal(String url, boolean gesture) {
        if (!UrlPolicy.isExternalAction(url)) {
            toast("Este tipo de enlace no está permitido."); return;
        }
        Runnable open = () -> {
            try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            } catch (ActivityNotFoundException error) { toast("No hay una aplicación para abrir este enlace."); }
        };
        if (gesture) open.run();
        else new AlertDialog.Builder(this).setTitle("Abrir enlace externo")
                .setMessage(Uri.parse(url).getHost() == null ? "Se abrirá otra aplicación." : Uri.parse(url).getHost())
                .setPositiveButton("Abrir", (d, which) -> open.run()).setNegativeButton("Cancelar", null).show();
    }

    private void showMenu() {
        String[] items = {"Configurar dirección del CRM", "Recargar", "Exportar respaldo JSON",
                "Abrir en navegador", "Acerca de esta versión"};
        new AlertDialog.Builder(this).setTitle("Nexo CRM").setItems(items, (d, which) -> {
            if (which == 0) showSettings();
            else if (which == 1) web.loadUrl(origin + "/");
            else if (which == 2) exportHttps(origin + "/api/workspace", "nexo-crm-respaldo.json", "application/json", true);
            else if (which == 3) openExternal(origin + "/", true);
            else new AlertDialog.Builder(this).setTitle("Nexo CRM · Pruebas")
                .setMessage("Versión 1.0.0 para instalación directa y validación en dispositivo.\n\n"
                        + "Usa el CRM privado publicado y necesita Internet. Los datos se guardan en el CRM. "
                        + "La aplicación no accede a conversaciones de WhatsApp Android; los mensajes se abren en WhatsApp para que confirmes su envío.\n\n"
                        + "El inicio de sesión debe probarse en el dispositivo antes de usar datos reales.")
                .setPositiveButton("Entendido", null).show();
        }).show();
    }

    private void showSettings() {
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(22), dp(8), dp(22), dp(4));
        TextView info = new TextView(this);
        info.setText("Introduce la dirección HTTPS del CRM de tu negocio. Debe estar publicado antes de entrar.");
        form.addView(info);
        EditText address = new EditText(this);
        address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        address.setSingleLine(true);
        address.setHint("https://tu-crm.workers.dev");
        address.setText(origin);
        form.addView(address);
        TextView authLabel = new TextView(this);
        authLabel.setText("Equipo Cloudflare Access (opcional)");
        form.addView(authLabel);
        EditText team = new EditText(this);
        team.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        team.setSingleLine(true);
        team.setHint("equipo.cloudflareaccess.com");
        team.setText(accessTeam);
        form.addView(team);
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("Conectar tu CRM")
                .setView(form).setPositiveButton("Guardar y abrir", null)
                .setNegativeButton("Cancelar", null).create();
        dialog.setOnShowListener(d -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            try {
                String selectedOrigin = UrlPolicy.normalizeOrigin(address.getText().toString());
                String selectedTeam = UrlPolicy.accessHost(team.getText().toString());
                if (!selectedOrigin.equals(origin)) {
                    web.clearHistory();
                    // A new CRM must authorize its own exact Access team.
                    if (selectedTeam.equals(accessTeam)) selectedTeam = "";
                }
                origin = selectedOrigin;
                accessTeam = selectedTeam;
                preferences.edit().putString("origin", origin).putString("accessTeam", accessTeam)
                        .putBoolean("configured", true).apply();
                dialog.dismiss();
                web.loadUrl(origin + "/");
            } catch (IllegalArgumentException error) { address.setError(error.getMessage()); }
        }));
        dialog.show();
    }

    private void exportBlob(String url, String filename, String mime) {
        if (pendingDownload != null) { toast("Termina de guardar el archivo anterior."); return; }
        final String key = "__nexoExport_" + UUID.randomUUID().toString().replace("-", "");
        String script = "(function(){const k=" + JSONObject.quote(key) + ";window[k]={state:'pending'};"
                + "fetch(" + JSONObject.quote(url) + ").then(r=>{if(!r.ok)throw Error('download');return r.blob()})"
                + ".then(b=>{if(b.size>" + MAX_DOWNLOAD + ")throw Error('size');const f=new FileReader();"
                + "f.onload=()=>window[k]={state:'done',data:f.result,type:b.type};f.onerror=()=>window[k]={state:'error'};"
                + "f.readAsDataURL(b)}).catch(()=>window[k]={state:'error'});return true})()";
        web.evaluateJavascript(script, ignored -> pollBlob(key, filename, mime, 0));
    }

    private void pollBlob(String key, String filename, String mime, int attempt) {
        if (destroyed || !UrlPolicy.isCrm(web.getUrl(), origin)) return;
        if (attempt > 60) { toast("La descarga tardó demasiado. Intenta de nuevo."); return; }
        web.evaluateJavascript("JSON.stringify(window[" + JSONObject.quote(key) + "]||{state:'error'})", encoded -> {
            try {
                String json = new org.json.JSONTokener(encoded).nextValue().toString();
                JSONObject result = new JSONObject(json);
                if ("pending".equals(result.optString("state"))) {
                    handler.postDelayed(() -> pollBlob(key, filename, mime, attempt + 1), 200); return;
                }
                web.evaluateJavascript("delete window[" + JSONObject.quote(key) + "]", null);
                if (!"done".equals(result.optString("state"))) { toast("No se pudo preparar el archivo."); return; }
                String data = result.getString("data");
                int separator = data.indexOf(',');
                if (separator < 0 || !data.substring(0, separator).endsWith(";base64")) throw new Exception();
                byte[] bytes = Base64.decode(data.substring(separator + 1), Base64.DEFAULT);
                if (bytes.length > MAX_DOWNLOAD) throw new Exception();
                String actualMime = mime == null ? result.optString("type", "application/octet-stream") : mime;
                String actualFilename = filename;
                if (actualFilename == null || actualFilename.isEmpty()) {
                    actualFilename = "nexo-crm";
                    if (actualMime.startsWith("application/json")) actualFilename += ".json";
                    else if (actualMime.startsWith("text/csv")) actualFilename += ".csv";
                    else if (actualMime.startsWith("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")) actualFilename += ".xlsx";
                    else if (actualMime.startsWith("application/pdf")) actualFilename += ".pdf";
                    else actualFilename += ".bin";
                }
                chooseSave(bytes, actualFilename, actualMime);
            } catch (Exception error) { toast("No se pudo preparar la descarga."); }
        });
    }

    private void exportHttps(String url, String filename, String mime, boolean workspaceBackup) {
        if (!UrlPolicy.isCrm(url, origin) || !UrlPolicy.isCrm(web.getUrl(), origin)) {
            toast("Primero inicia sesión en tu CRM."); return;
        }
        if (pendingDownload != null) { toast("Termina de guardar el archivo anterior."); return; }
        final String cookies = CookieManager.getInstance().getCookie(origin);
        toast("Preparando archivo…");
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(20000);
                connection.setRequestProperty("Accept", workspaceBackup ? "application/json" : "*/*");
                if (cookies != null) connection.setRequestProperty("Cookie", cookies);
                if (connection.getResponseCode() != 200) throw new Exception();
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                try (InputStream input = connection.getInputStream()) {
                    byte[] buffer = new byte[8192]; int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (output.size() + count > MAX_DOWNLOAD) throw new Exception();
                        output.write(buffer, 0, count);
                    }
                }
                byte[] bytes = output.toByteArray();
                if (workspaceBackup) {
                    JSONObject response = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
                    bytes = response.getJSONObject("state").toString(2).getBytes(StandardCharsets.UTF_8);
                }
                final byte[] content = bytes;
                handler.post(() -> chooseSave(content, filename, mime));
            } catch (Exception error) {
                handler.post(() -> toast("No se pudo descargar. Verifica tu sesión y vuelve a intentar."));
            } finally { if (connection != null) connection.disconnect(); }
        }, "nexo-download").start();
    }

    private void chooseSave(byte[] bytes, String filename, String mime) {
        if (destroyed) return;
        if (pendingDownload != null) { toast("Termina de guardar el archivo anterior."); return; }
        pendingDownload = bytes;
        pendingFilename = UrlPolicy.safeFilename(filename);
        String plainMime = mime == null ? "" : mime.split(";", 2)[0].trim();
        pendingMime = plainMime.matches("[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+") ? plainMime : "application/octet-stream";
        Intent create = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType(pendingMime).putExtra(Intent.EXTRA_TITLE, pendingFilename);
        try { startActivityForResult(create, SAVE_FILE); }
        catch (ActivityNotFoundException error) { pendingDownload = null; toast("No se encontró una aplicación para guardar archivos."); }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == OPEN_FILE && upload != null) {
            Uri[] selection = WebChromeClient.FileChooserParams.parseResult(result, data);
            upload.onReceiveValue(selection); upload = null;
        }
        if (request == SAVE_FILE) {
            final byte[] bytes = pendingDownload;
            pendingDownload = null;
            if (result != RESULT_OK || data == null || data.getData() == null || bytes == null) return;
            final Uri destination = data.getData();
            new Thread(() -> {
                try (OutputStream output = getContentResolver().openOutputStream(destination, "w")) {
                    if (output == null) throw new Exception();
                    output.write(bytes);
                    handler.post(() -> toast("Archivo guardado. Conserva tus respaldos de forma privada."));
                } catch (Exception error) { handler.post(() -> toast("No se pudo guardar el archivo.")); }
            }, "nexo-save").start();
        }
    }

    private void showNotice(String text) { notice.setText(text); notice.setVisibility(View.VISIBLE); }
    private void toast(String text) { if (!destroyed) Toast.makeText(this, text, Toast.LENGTH_LONG).show(); }
    private void goBack() { if (web.canGoBack()) web.goBack(); else finish(); }
    @Override public void onBackPressed() { goBack(); }
    @Override protected void onSaveInstanceState(Bundle state) { super.onSaveInstanceState(state); web.saveState(state); }
    @Override protected void onStop() { CookieManager.getInstance().flush(); super.onStop(); }
    @Override protected void onDestroy() {
        destroyed = true; handler.removeCallbacksAndMessages(null);
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null)
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
        if (upload != null) upload.onReceiveValue(null);
        pendingDownload = null;
        web.stopLoading(); web.destroy();
        super.onDestroy();
    }
}
