#include "ThreadPool.hpp"
#include <random>
#include <sstream>
#include <iomanip>

namespace crossnative {

ThreadPool::ThreadPool(size_t numThreads) {
  workers_.reserve(numThreads);
  for (size_t i = 0; i < numThreads; ++i) {
    workers_.emplace_back([this] { workerLoop(); });
  }
}

ThreadPool::~ThreadPool() {
  shutdown();
}

void ThreadPool::cancelAll() {
  std::lock_guard<std::mutex> lock(queueMutex_);
  
  // Mark all tasks as cancelled
  auto tempQueue = tasks_;
  while (!tempQueue.empty()) {
    auto task = tempQueue.top();
    if (task.cancelled) {
      task.cancelled->store(true);
    }
    tempQueue.pop();
  }
  
  // Clear the queue
  while (!tasks_.empty()) {
    tasks_.pop();
  }
}

void ThreadPool::shutdown() {
  {
    std::unique_lock<std::mutex> lock(queueMutex_);
    stop_ = true;
  }
  
  condition_.notify_all();
  
  for (std::thread& worker : workers_) {
    if (worker.joinable()) {
      worker.join();
    }
  }
}

std::string ThreadPool::generateTaskId() {
  static std::atomic<int> counter{0};
  std::stringstream ss;
  ss << "task_" << std::hex << std::setfill('0') << std::setw(8)
     << std::hash<std::thread::id>{}(std::this_thread::get_id())
     << "_" << counter++;
  return ss.str();
}

void ThreadPool::workerLoop() {
  while (true) {
    Task task;
    
    {
      std::unique_lock<std::mutex> lock(queueMutex_);
      
      condition_.wait(lock, [this] {
        return stop_ || !tasks_.empty();
      });
      
      if (stop_ && tasks_.empty()) {
        return;
      }
      
      // priority_queue only exposes a const top(); moving out is safe because
      // we pop the element immediately afterwards.
      task = std::move(const_cast<Task&>(tasks_.top()));
      tasks_.pop();
    }
    
    // Check if task was cancelled
    if (task.cancelled && task.cancelled->load()) {
      continue;
    }
    
    // Execute task
    activeCount_++;
    try {
      task.func();
    } catch (const std::exception& e) {
      // Log error but don't crash the worker
      // In production, report to error tracking
    }
    activeCount_--;
  }
}

} // namespace crossnative
