package hr.mrodek.apps.futsal_turniri.repository;

import hr.mrodek.apps.futsal_turniri.model.AppSetting;
import jakarta.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class AppSettingsRepository implements AppRepository<AppSetting, String> {

    /** Setting value by key, or {@code null} when unset. */
    public String get(String key) {
        return findByIdOptional(key).map(AppSetting::getValue).orElse(null);
    }

    /** Upsert one setting. {@code null} value is stored as-is (means "unset"). */
    public void put(String key, String value) {
        AppSetting row = findById(key);
        if (row == null) {
            persist(new AppSetting(key, value));
        } else {
            row.setValue(value);
        }
    }
}
