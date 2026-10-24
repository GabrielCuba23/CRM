package com.nexocrm.mobile;

public final class UrlPolicyTest {
    private static int checks;
    private static void check(boolean condition) {
        checks++;
        if (!condition) throw new AssertionError("URL policy check " + checks + " failed");
    }
    private static void rejects(String value) {
        try { UrlPolicy.normalizeOrigin(value); throw new AssertionError("Accepted unsafe origin"); }
        catch (IllegalArgumentException expected) { checks++; }
    }
    public static void main(String[] args) {
        check(UrlPolicy.normalizeOrigin("https://CRM.example/").equals("https://crm.example"));
        check(UrlPolicy.normalizeOrigin("https://crm.example:443").equals("https://crm.example"));
        rejects("http://crm.example"); rejects("javascript:alert(1)");
        rejects("https://name:pass@crm.example"); rejects("https://crm.example/another");
        rejects("https://crm.example:8443"); rejects("https://crm.example?next=evil");
        rejects("https://crm.example#fragment"); rejects("https://localhost");
        check(UrlPolicy.isCrm("https://crm.example/api/workspace", "https://crm.example"));
        check(!UrlPolicy.isCrm("https://crm.example.evil.test/", "https://crm.example"));
        check(!UrlPolicy.isCrm("https://crm.example@evil.test/", "https://crm.example"));
        check(!UrlPolicy.isCrm("https://crm.example:8443/", "https://crm.example"));
        check(!UrlPolicy.isCrm("http://crm.example/", "https://crm.example"));
        check(UrlPolicy.isCrmBlob("blob:https://crm.example/abc-123", "https://crm.example"));
        check(!UrlPolicy.isCrmBlob("blob:https://crm.example.evil.test/abc", "https://crm.example"));
        check(!UrlPolicy.isCrmBlob("blob:https://other.example/abc", "https://crm.example"));
        check(!UrlPolicy.isCrmBlob("blob:https://user@crm.example/abc", "https://crm.example"));
        check(UrlPolicy.isAccess("https://team.cloudflareaccess.com/login", "team.cloudflareaccess.com"));
        check(!UrlPolicy.isAccess("https://another.cloudflareaccess.com/", "team.cloudflareaccess.com"));
        check(UrlPolicy.candidateAccessHost("https://team.cloudflareaccess.com/login").equals("team.cloudflareaccess.com"));
        check(UrlPolicy.candidateAccessHost("https://team.cloudflareaccess.com.evil.test/login").isEmpty());
        check(UrlPolicy.candidateAccessHost("https://team.cloudflareaccess.com:8443/login").isEmpty());
        check(!UrlPolicy.isExternalAction("javascript:alert(1)"));
        check(!UrlPolicy.isExternalAction("file:///data/data/private"));
        check(!UrlPolicy.isExternalAction("intent://send#Intent;scheme=whatsapp;end"));
        check(UrlPolicy.isExternalAction("whatsapp://send?phone=51999999999"));
        check(UrlPolicy.isExternalAction("https://wa.me/51999999999"));
        check(!UrlPolicy.isExternalAction("whatsapp://settings"));
        check(UrlPolicy.safeFilename("../../datos.json").equals(".._.._datos.json"));
        check(UrlPolicy.safeFilename("..").equals("archivo-crm"));
        System.out.println("Android URL policy: " + checks + " checks passed");
    }
}
