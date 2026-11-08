self.addEventListener('install', function () {
  fetch('http://[::1]:1/sw').catch(function () {});
});
