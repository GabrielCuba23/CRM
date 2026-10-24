package com.nexocrm.mobile;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/** The app opens one explicitly configured HTTPS CRM and one Access team. */
public final class UrlPolicy {
    private UrlPolicy() {}

    public static String normalizeOrigin(String input) {
        if (input == null) throw new IllegalArgumentException("Introduce la URL HTTPS del CRM.");
        try {
            URI uri = new URI(input.trim());
            String host = uri.getHost();
            if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null
                    || host.indexOf('.') < 0 || uri.getUserInfo() != null
                    || (uri.getPort() != -1 && uri.getPort() != 443)
                    || (uri.getRawPath() != null && !uri.getRawPath().isEmpty()
                        && !"/".equals(uri.getRawPath()))
                    || uri.getQuery() != null || uri.getFragment() != null) {
                throw new IllegalArgumentException("Usa la dirección HTTPS del CRM, sin rutas, puertos ni credenciales.");
            }
            return "https://" + host.toLowerCase(Locale.ROOT);
        } catch (URISyntaxException error) {
            throw new IllegalArgumentException("La URL del CRM no es válida.");
        }
    }

    public static String accessHost(String input) {
        if (input == null || input.trim().isEmpty()) return "";
        String host = input.trim().toLowerCase(Locale.ROOT);
        if (!host.matches("[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.cloudflareaccess\\.com")) {
            throw new IllegalArgumentException("El equipo Access debe tener el formato equipo.cloudflareaccess.com.");
        }
        return host;
    }

    public static boolean isCrm(String url, String origin) {
        try {
            URI uri = new URI(url);
            return "https".equalsIgnoreCase(uri.getScheme()) && uri.getUserInfo() == null
                    && (uri.getPort() == -1 || uri.getPort() == 443)
                    && new URI(origin).getHost().equalsIgnoreCase(uri.getHost());
        } catch (Exception error) { return false; }
    }

    public static boolean isAccess(String url, String trustedHost) {
        try {
            URI uri = new URI(url);
            return !trustedHost.isEmpty() && "https".equalsIgnoreCase(uri.getScheme())
                    && uri.getUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443)
                    && trustedHost.equalsIgnoreCase(uri.getHost());
        } catch (Exception error) { return false; }
    }

    public static String candidateAccessHost(String url) {
        try {
            URI uri = new URI(url);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getUserInfo() != null
                    || (uri.getPort() != -1 && uri.getPort() != 443)) return "";
            return accessHost(uri.getHost());
        } catch (Exception error) { return ""; }
    }

    public static boolean isCrmBlob(String url, String origin) {
        return url != null && url.startsWith("blob:" + origin + "/")
                && isCrm(url.substring(5), origin);
    }

    public static boolean isExternalAction(String url) {
        try {
            URI uri = new URI(url);
            String scheme = uri.getScheme();
            if ("whatsapp".equalsIgnoreCase(scheme)) return "send".equalsIgnoreCase(uri.getHost());
            if ("mailto".equalsIgnoreCase(scheme) || "tel".equalsIgnoreCase(scheme)) return true;
            return "https".equalsIgnoreCase(scheme) && uri.getUserInfo() == null
                    && (uri.getPort() == -1 || uri.getPort() == 443)
                    && uri.getHost() != null;
        } catch (Exception error) { return false; }
    }

    public static String safeFilename(String proposed) {
        String name = proposed == null ? "archivo-crm" : proposed;
        name = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
        if (name.length() > 120) name = name.substring(name.length() - 120);
        if (name.isEmpty() || name.equals(".") || name.equals("..")) return "archivo-crm";
        return name;
    }
}
