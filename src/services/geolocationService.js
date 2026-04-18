// Get current device location
export const getCurrentLocation = () => {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation không được hỗ trợ trên trình duyệt này'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        resolve({
          lat: latitude,
          lng: longitude,
          accuracy,
        });
      },
      (error) => {
        reject(error);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  });
};

// Watch location changes (realtime)
export const watchLocation = (callback, onError) => {
  if (!navigator.geolocation) {
    onError(new Error('Geolocation không được hỗ trợ'));
    return;
  }

  const watchId = navigator.geolocation.watchPosition(
    (position) => {
      const { latitude, longitude, accuracy } = position.coords;
      callback({
        lat: latitude,
        lng: longitude,
        accuracy,
      });
    },
    (error) => {
      onError(error);
    },
    {
      enableHighAccuracy: true,
      timeout: 5000,
      maximumAge: 0,
    }
  );

  // Return function to stop watching
  return () => navigator.geolocation.clearWatch(watchId);
};
